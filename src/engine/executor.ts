// =============================================================================
// Automation Executor
// Orchestrates: Trigger → Condition → Action pipeline
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { ConditionEvaluator } from './condition-evaluator';
import { ActionRunner } from './action-runner';
import { TemplateResolver } from './template-resolver';
import { TriggerManager } from './trigger-manager';
import {
  AutomationRule, TriggerEvent, ExecutionContext,
  ConditionConfig, ActionConfig
} from './types';
import { logger } from '../utils/logger';

export interface ExecutorConfig {
  maxConcurrentExecutions: number;
  pollIntervalMs: number;
  minPollIntervalMs: number;
}

export class AutomationExecutor {
  private prisma: PrismaClient;
  private onstaqClient: OnstaqClient;
  private templateResolver: TemplateResolver;
  private conditionEvaluator: ConditionEvaluator;
  private actionRunner: ActionRunner;
  private triggerManager: TriggerManager;
  private config: ExecutorConfig;
  private activeExecutions: number = 0;
  private executionQueue: Array<{ automation: AutomationRule; event: TriggerEvent; resolve: (id: string) => void; reject: (err: Error) => void }> = [];

  constructor(prisma: PrismaClient, onstaqClient: OnstaqClient, config?: Partial<ExecutorConfig>) {
    this.prisma = prisma;
    this.onstaqClient = onstaqClient;
    this.config = {
      maxConcurrentExecutions: config?.maxConcurrentExecutions || 10,
      pollIntervalMs: config?.pollIntervalMs || 60000,
      minPollIntervalMs: config?.minPollIntervalMs || 10000,
    };

    this.templateResolver = new TemplateResolver(onstaqClient);
    this.conditionEvaluator = new ConditionEvaluator(onstaqClient, this.templateResolver);
    this.actionRunner = new ActionRunner(
      onstaqClient,
      this.templateResolver,
      this.chainTrigger.bind(this)
    );

    this.triggerManager = new TriggerManager(
      prisma,
      onstaqClient,
      this.handleTriggerEvent.bind(this),
      {
        defaultPollIntervalMs: this.config.pollIntervalMs,
        minPollIntervalMs: this.config.minPollIntervalMs,
      }
    );
  }

  /**
   * Start the executor: load automations and begin watching triggers.
   */
  async start(): Promise<void> {
    logger.info('Starting automation executor...');

    // Ensure ONSTAQ authentication
    await this.onstaqClient.login();
    logger.info('Authenticated with ONSTAQ');

    // Load all enabled automations
    const automations = await this.loadAutomations();
    logger.info(`Loaded ${automations.length} enabled automations`);

    // Start trigger manager
    await this.triggerManager.startAll(automations);
    logger.info('Automation executor running');
  }

  /**
   * Stop the executor gracefully.
   */
  async stop(): Promise<void> {
    logger.info('Stopping automation executor...');
    this.triggerManager.stopAll();
    // Wait for active executions to complete (with timeout)
    const timeout = 30000;
    const start = Date.now();
    while (this.activeExecutions > 0 && Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 500));
    }
    logger.info('Automation executor stopped');
  }

  /**
   * Manually trigger an automation.
   */
  async triggerManually(automationId: string, parameters?: Record<string, any>): Promise<string> {
    const automation = await this.getAutomationRule(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);

    const event: TriggerEvent = {
      type: 'manual',
      automationId,
      timestamp: new Date().toISOString(),
      manualParameters: parameters,
    };

    return this.executeAutomation(automation, event);
  }

  /**
   * Dry-run an automation (evaluate conditions but don't execute actions).
   */
  async testAutomation(automationId: string, mockTriggerData?: Partial<TriggerEvent>): Promise<{
    conditionResult: { passed: boolean; details: Record<string, any> };
    wouldExecuteActions: string[];
  }> {
    const automation = await this.getAutomationRule(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);

    const event: TriggerEvent = {
      type: automation.trigger.type,
      automationId,
      timestamp: new Date().toISOString(),
      ...mockTriggerData,
    };

    const ctx: ExecutionContext = {
      automationId: automation.id,
      automationName: automation.name,
      workspaceId: automation.workspaceId,
      trigger: event,
      actionResults: [],
      variables: {},
      startedAt: new Date(),
    };

    const conditionResult = await this.conditionEvaluator.evaluate(
      automation.conditions as ConditionConfig | null,
      ctx
    );

    return {
      conditionResult,
      wouldExecuteActions: conditionResult.passed
        ? (automation.actions as ActionConfig[]).map((a, i) => `[${i}] ${a.type}${a.name ? ` (${a.name})` : ''}`)
        : [],
    };
  }

  /**
   * Reload triggers for a specific automation (e.g., after update).
   */
  async reloadAutomation(automationId: string): Promise<void> {
    this.triggerManager.stopOne(automationId);

    const automation = await this.getAutomationRule(automationId);
    if (automation?.enabled) {
      await this.triggerManager.startOne(automation);
    }
  }

  // ===========================================================================
  // Internal: Trigger event handler
  // ===========================================================================

  private async handleTriggerEvent(event: TriggerEvent): Promise<void> {
    const automation = await this.getAutomationRule(event.automationId);
    if (!automation || !automation.enabled) return;

    try {
      await this.executeAutomation(automation, event);
    } catch (err: any) {
      logger.error(`Automation ${automation.id} execution error: ${err.message}`);
    }
  }

  /**
   * Full execution pipeline: create execution record → evaluate conditions → run actions.
   */
  private async executeAutomation(automation: AutomationRule, event: TriggerEvent): Promise<string> {
    if (this.activeExecutions >= this.config.maxConcurrentExecutions) {
      logger.info(`Concurrency limit reached (${this.config.maxConcurrentExecutions}), queuing "${automation.name}" (queue size: ${this.executionQueue.length})`);
      return new Promise<string>((resolve, reject) => {
        this.executionQueue.push({ automation, event, resolve, reject });
      });
    }

    return this.runExecution(automation, event);
  }

  private async drainQueue(): Promise<void> {
    while (this.executionQueue.length > 0 && this.activeExecutions < this.config.maxConcurrentExecutions) {
      const next = this.executionQueue.shift()!;
      logger.info(`Dequeuing automation "${next.automation.name}" (remaining: ${this.executionQueue.length})`);
      this.runExecution(next.automation, next.event).then(next.resolve, next.reject);
    }
  }

  private async runExecution(automation: AutomationRule, event: TriggerEvent): Promise<string> {
    this.activeExecutions++;
    const startTime = new Date();

    // Create execution record
    const execution = await this.prisma.execution.create({
      data: {
        automationId: automation.id,
        status: 'RUNNING',
        triggerData: event as any,
        startedAt: startTime,
      },
    });

    const ctx: ExecutionContext = {
      automationId: automation.id,
      automationName: automation.name,
      workspaceId: automation.workspaceId,
      trigger: event,
      actionResults: [],
      variables: {},
      startedAt: startTime,
    };

    try {
      // 1. Evaluate conditions
      const conditionResult = await this.conditionEvaluator.evaluate(
        automation.conditions as ConditionConfig | null,
        ctx
      );
      ctx.conditionResult = conditionResult;

      if (!conditionResult.passed) {
        // Conditions not met — skip
        await this.prisma.execution.update({
          where: { id: execution.id },
          data: {
            status: 'SKIPPED',
            conditionResult: conditionResult as any,
            completedAt: new Date(),
            durationMs: Date.now() - startTime.getTime(),
          },
        });

        logger.info(`Automation ${automation.name} skipped: conditions not met`);
        this.activeExecutions--;
        this.drainQueue();
        return execution.id;
      }

      // 2. Execute actions
      const actions = automation.actions as ActionConfig[];
      const actionResults = await this.actionRunner.executeAll(actions, ctx);

      const hasFailure = actionResults.some((r) => r.status === 'failed');
      const finalStatus = hasFailure ? 'FAILED' : 'SUCCESS';

      // 3. Update execution record
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: finalStatus,
          conditionResult: conditionResult as any,
          actionResults: actionResults as any,
          error: hasFailure ? actionResults.find((r) => r.status === 'failed')?.error : null,
          completedAt: new Date(),
          durationMs: Date.now() - startTime.getTime(),
        },
      });

      logger.info(`Automation "${automation.name}" ${finalStatus} in ${Date.now() - startTime.getTime()}ms`);
      this.activeExecutions--;
      this.drainQueue();
      return execution.id;
    } catch (err: any) {
      // Unexpected error
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: 'FAILED',
          conditionResult: ctx.conditionResult as any,
          actionResults: ctx.actionResults as any,
          error: err.message,
          completedAt: new Date(),
          durationMs: Date.now() - startTime.getTime(),
        },
      });

      this.activeExecutions--;
      this.drainQueue();
      throw err;
    }
  }

  // ===========================================================================
  // Chain triggering (for automation.trigger action)
  // ===========================================================================

  private async chainTrigger(automationId: string, parameters?: Record<string, any>): Promise<void> {
    await this.triggerManually(automationId, parameters);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async loadAutomations(): Promise<AutomationRule[]> {
    const records = await this.prisma.automation.findMany({
      where: { enabled: true },
      orderBy: { executionOrder: 'asc' },
    });

    return records.map(this.toAutomationRule);
  }

  private async getAutomationRule(id: string): Promise<AutomationRule | null> {
    const record = await this.prisma.automation.findUnique({ where: { id } });
    return record ? this.toAutomationRule(record) : null;
  }

  private toAutomationRule(record: any): AutomationRule {
    return {
      id: record.id,
      name: record.name,
      description: record.description,
      workspaceId: record.workspaceId,
      workspaceKey: record.workspaceKey,
      enabled: record.enabled,
      trigger: record.trigger as any,
      conditions: record.conditions as any,
      actions: record.actions as any,
      executionOrder: record.executionOrder,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

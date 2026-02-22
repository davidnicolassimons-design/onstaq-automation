// =============================================================================
// Automation Executor
// Orchestrates: Trigger → Component chain (actions, conditions, branches, if/else)
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { ConditionEvaluator } from './condition-evaluator';
import { ActionRunner } from './action-runner';
import { TemplateResolver } from './template-resolver';
import { TriggerManager } from './trigger-manager';
import {
  AutomationRule, TriggerEvent, ExecutionContext,
  RuleComponent, ComponentResult, ConditionConfig,
  ActionConfig, BranchConfig, IfElseConfig, Item
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

    // If an itemId or itemKey is passed, fetch the item so actions with useTriggeredItem work
    if (parameters?.itemId) {
      try {
        const item = await this.onstaqClient.getItem(parameters.itemId);
        if (!item || typeof item === 'string' || !item.id) {
          throw new Error(`Got invalid response instead of item data — check ONSTAQ_API_URL is pointing to the backend API, not the frontend`);
        }
        event.item = item;
      } catch (err: any) {
        logger.error(`Failed to fetch item ${parameters.itemId} for manual trigger: ${err.message}`);
        throw new Error(`Failed to fetch item by ID "${parameters.itemId}": ${err.message}`);
      }
    } else if (parameters?.itemKey) {
      try {
        const result = await this.onstaqClient.listItems({ key: parameters.itemKey, workspaceId: automation.workspaceId });
        if (!result || typeof result === 'string' || !Array.isArray(result.data)) {
          throw new Error(`Got invalid response instead of items list — check ONSTAQ_API_URL is pointing to the backend API, not the frontend`);
        }
        if (result.data.length > 0) {
          event.item = result.data[0];
        } else {
          throw new Error(`No item found with key "${parameters.itemKey}" in workspace ${automation.workspaceId}`);
        }
      } catch (err: any) {
        if (err.message.startsWith('No item found') || err.message.startsWith('Got invalid')) throw err;
        logger.error(`Failed to fetch item by key ${parameters.itemKey}: ${err.message}`);
        throw new Error(`Failed to fetch item by key "${parameters.itemKey}": ${err.message}`);
      }
    }

    return this.executeAutomation(automation, event);
  }

  /**
   * Dry-run an automation (evaluate conditions but don't execute actions).
   */
  async testAutomation(automationId: string, mockTriggerData?: Partial<TriggerEvent>): Promise<{
    conditionResult: { passed: boolean; details: Record<string, any> };
    wouldExecuteComponents: string[];
  }> {
    const automation = await this.getAutomationRule(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);

    const event: TriggerEvent = {
      type: automation.trigger.type,
      automationId,
      timestamp: new Date().toISOString(),
      ...mockTriggerData,
    };

    // Summarize what would execute
    const describeComponents = (comps: RuleComponent[], prefix = ''): string[] => {
      const lines: string[] = [];
      for (const comp of comps) {
        switch (comp.componentType) {
          case 'action':
            lines.push(`${prefix}[action] ${comp.action?.type}${comp.action?.name ? ` (${comp.action.name})` : ''}`);
            break;
          case 'condition':
            lines.push(`${prefix}[condition] ${(comp.condition as any)?.type || 'group'}`);
            break;
          case 'branch':
            lines.push(`${prefix}[branch] ${comp.branch?.type}`);
            if (comp.branch?.components) {
              lines.push(...describeComponents(comp.branch.components, prefix + '  '));
            }
            break;
          case 'if_else':
            lines.push(`${prefix}[if/else]`);
            if (comp.ifElse?.then) {
              lines.push(`${prefix}  [then]`);
              lines.push(...describeComponents(comp.ifElse.then, prefix + '    '));
            }
            if (comp.ifElse?.else) {
              lines.push(`${prefix}  [else]`);
              lines.push(...describeComponents(comp.ifElse.else, prefix + '    '));
            }
            break;
        }
      }
      return lines;
    };

    return {
      conditionResult: { passed: true, details: { reason: 'Dry run — conditions not evaluated in new model' } },
      wouldExecuteComponents: describeComponents(automation.components as RuleComponent[]),
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
   * Full execution pipeline: create execution record → execute component chain.
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
      componentResults: [],
      variables: {},
      createdItems: [],
      currentItem: event.item,
      startedAt: startTime,
    };

    try {
      // Execute the component chain
      const components = automation.components as RuleComponent[];
      const componentResults = await this.executeComponents(components, ctx);

      const hasFailure = this.hasFailure(componentResults);
      const finalStatus = hasFailure ? 'FAILED' : 'SUCCESS';

      // Update execution record
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          status: finalStatus,
          componentResults: componentResults as any,
          error: hasFailure ? this.findFirstError(componentResults) : null,
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
          componentResults: ctx.componentResults as any,
          error: err.message,
          completedAt: new Date(),
          durationMs: Date.now() - startTime.getTime(),
        },
      });

      this.activeExecutions--;
      this.drainQueue();
      return execution.id;
    }
  }

  // ===========================================================================
  // Component Chain Execution (recursive)
  // ===========================================================================

  private async executeComponents(components: RuleComponent[], ctx: ExecutionContext): Promise<ComponentResult[]> {
    const results: ComponentResult[] = [];

    for (const comp of components) {
      const start = Date.now();
      let result: ComponentResult;

      try {
        switch (comp.componentType) {
          case 'action':
            result = await this.executeActionComponent(comp, ctx);
            break;
          case 'condition':
            result = await this.executeConditionComponent(comp, ctx);
            break;
          case 'branch':
            result = await this.executeBranchComponent(comp, ctx);
            break;
          case 'if_else':
            result = await this.executeIfElseComponent(comp, ctx);
            break;
          default:
            result = {
              componentId: comp.id,
              componentType: comp.componentType,
              status: 'failed',
              error: `Unknown component type: ${comp.componentType}`,
              durationMs: Date.now() - start,
            };
        }
      } catch (err: any) {
        result = {
          componentId: comp.id,
          componentType: comp.componentType,
          status: 'failed',
          error: err.message,
          durationMs: Date.now() - start,
        };
      }

      results.push(result);
      ctx.componentResults.push(result);

      // If a condition fails, stop remaining components
      if (comp.componentType === 'condition' && result.status === 'skipped') {
        logger.info(`Condition ${comp.id} not met — stopping component chain`);
        break;
      }

      // If an action fails and continueOnError is not set, stop
      if (comp.componentType === 'action' && result.status === 'failed') {
        const continueOnError = comp.action?.continueOnError ?? false;
        if (!continueOnError) {
          logger.warn(`Action ${comp.id} failed — stopping component chain`);
          break;
        }
      }
    }

    return results;
  }

  private async executeActionComponent(comp: RuleComponent, ctx: ExecutionContext): Promise<ComponentResult> {
    const action = comp.action as ActionConfig;
    const start = Date.now();

    const actionResult = await this.actionRunner.executeOne(action, ctx);

    return {
      componentId: comp.id,
      componentType: 'action',
      actionType: action.type,
      status: actionResult.status,
      result: actionResult.result,
      error: actionResult.error,
      durationMs: Date.now() - start,
    };
  }

  private async executeConditionComponent(comp: RuleComponent, ctx: ExecutionContext): Promise<ComponentResult> {
    const condition = comp.condition as ConditionConfig;
    const start = Date.now();

    const condResult = await this.conditionEvaluator.evaluate(condition, ctx);

    return {
      componentId: comp.id,
      componentType: 'condition',
      status: condResult.passed ? 'success' : 'skipped',
      result: condResult.details,
      durationMs: Date.now() - start,
    };
  }

  private async executeBranchComponent(comp: RuleComponent, ctx: ExecutionContext): Promise<ComponentResult> {
    const branch = comp.branch as BranchConfig;
    const start = Date.now();
    const childResults: ComponentResult[] = [];

    // Resolve target items based on branch type
    let items: Item[] = [];

    switch (branch.type) {
      case 'related_items': {
        const sourceItem = ctx.currentItem || ctx.trigger.item;
        if (!sourceItem) {
          return {
            componentId: comp.id,
            componentType: 'branch',
            status: 'skipped',
            error: 'No source item for related_items branch',
            durationMs: Date.now() - start,
          };
        }

        const refs = await this.onstaqClient.getReferences(sourceItem.id);
        const relevantRefs = branch.direction === 'inbound' ? refs.inbound : refs.outbound;

        let filtered = relevantRefs;
        if (branch.referenceKind) {
          filtered = filtered.filter((r) => r.referenceKind === branch.referenceKind);
        }

        // Fetch full items for each reference
        for (const ref of filtered) {
          try {
            const targetId = branch.direction === 'inbound' ? ref.fromItemId : ref.toItemId;
            const item = await this.onstaqClient.getItem(targetId);

            // Filter by catalog if specified
            if (branch.catalogId && item.catalogId !== branch.catalogId) continue;

            items.push(item);
          } catch (err: any) {
            logger.warn(`Could not fetch referenced item: ${err.message}`);
          }
        }
        break;
      }

      case 'created_items': {
        items = [...ctx.createdItems];
        break;
      }

      case 'lookup_items': {
        if (!branch.oqlQuery) {
          return {
            componentId: comp.id,
            componentType: 'branch',
            status: 'failed',
            error: 'lookup_items branch requires oqlQuery',
            durationMs: Date.now() - start,
          };
        }

        const resolvedQuery = await this.templateResolver.resolveString(branch.oqlQuery, ctx);
        const oqlResult = await this.onstaqClient.executeOql(resolvedQuery, ctx.workspaceId);

        // Each row should have an id field to fetch the full item
        for (const row of oqlResult.rows || []) {
          const itemId = row.id || row.itemId;
          if (itemId) {
            try {
              items.push(await this.onstaqClient.getItem(itemId));
            } catch (err: any) {
              logger.warn(`Could not fetch lookup item ${itemId}: ${err.message}`);
            }
          }
        }
        break;
      }
    }

    logger.info(`Branch ${branch.type}: found ${items.length} items to iterate`);

    // Execute sub-components for each item
    for (const item of items) {
      const branchCtx: ExecutionContext = {
        ...ctx,
        currentItem: item,
        componentResults: [], // Separate results for branch iteration
      };

      const iterResults = await this.executeComponents(branch.components as RuleComponent[], branchCtx);
      childResults.push(...iterResults);

      // Merge created items back to parent context
      ctx.createdItems.push(...branchCtx.createdItems.filter(
        (ci) => !ctx.createdItems.some((existing) => existing.id === ci.id)
      ));
    }

    const hasBranchFailure = this.hasFailure(childResults);

    return {
      componentId: comp.id,
      componentType: 'branch',
      status: hasBranchFailure ? 'failed' : 'success',
      result: { itemCount: items.length, branchType: branch.type },
      children: childResults,
      durationMs: Date.now() - start,
    };
  }

  private async executeIfElseComponent(comp: RuleComponent, ctx: ExecutionContext): Promise<ComponentResult> {
    const ifElse = comp.ifElse as IfElseConfig;
    const start = Date.now();

    // Evaluate condition
    const condResult = await this.conditionEvaluator.evaluate(ifElse.conditions as ConditionConfig, ctx);

    let childResults: ComponentResult[];
    let branch: string;

    if (condResult.passed) {
      branch = 'then';
      childResults = await this.executeComponents(ifElse.then as RuleComponent[], ctx);
    } else if (ifElse.else && ifElse.else.length > 0) {
      branch = 'else';
      childResults = await this.executeComponents(ifElse.else as RuleComponent[], ctx);
    } else {
      branch = 'skipped';
      childResults = [];
    }

    const hasChildFailure = this.hasFailure(childResults);

    return {
      componentId: comp.id,
      componentType: 'if_else',
      status: hasChildFailure ? 'failed' : 'success',
      result: { conditionPassed: condResult.passed, branch, conditionDetails: condResult.details },
      children: childResults,
      durationMs: Date.now() - start,
    };
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

  private hasFailure(results: ComponentResult[]): boolean {
    return results.some((r) => {
      if (r.status === 'failed') return true;
      if (r.children) return this.hasFailure(r.children);
      return false;
    });
  }

  private findFirstError(results: ComponentResult[]): string | null {
    for (const r of results) {
      if (r.status === 'failed' && r.error) return r.error;
      if (r.children) {
        const childError = this.findFirstError(r.children);
        if (childError) return childError;
      }
    }
    return null;
  }

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
      components: record.components as any,
      executionOrder: record.executionOrder,
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

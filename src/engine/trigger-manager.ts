// =============================================================================
// Trigger Manager
// Manages polling, scheduling, and webhook-based trigger detection
// =============================================================================

import { CronJob } from 'cron';
import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import {
  TriggerConfig, TriggerEvent, TriggerType,
  ItemCreatedTrigger, ItemUpdatedTrigger,
  AttributeChangedTrigger, StatusChangedTrigger,
  ScheduleTrigger, OqlMatchTrigger, AutomationRule
} from './types';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export interface TriggerManagerConfig {
  defaultPollIntervalMs: number;  // Default: 60000
  minPollIntervalMs: number;      // Default: 10000
}

type TriggerHandler = (event: TriggerEvent) => Promise<void>;

export class TriggerManager {
  private prisma: PrismaClient;
  private onstaqClient: OnstaqClient;
  private config: TriggerManagerConfig;
  private handler: TriggerHandler;

  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private cronJobs: Map<string, CronJob> = new Map();
  private running: boolean = false;

  constructor(
    prisma: PrismaClient,
    onstaqClient: OnstaqClient,
    handler: TriggerHandler,
    config?: Partial<TriggerManagerConfig>
  ) {
    this.prisma = prisma;
    this.onstaqClient = onstaqClient;
    this.handler = handler;
    this.config = {
      defaultPollIntervalMs: config?.defaultPollIntervalMs || 60000,
      minPollIntervalMs: config?.minPollIntervalMs || 10000,
    };
  }

  /**
   * Start watching all enabled automations.
   */
  async startAll(automations: AutomationRule[]): Promise<void> {
    this.running = true;
    const enabled = automations.filter((a) => a.enabled);

    for (const automation of enabled) {
      await this.startOne(automation);
    }

    logger.info(`Trigger manager started: ${enabled.length} automations active`);
  }

  /**
   * Register and start triggers for a single automation.
   */
  async startOne(automation: AutomationRule): Promise<void> {
    if (!this.running) return;

    const trigger = automation.trigger;

    switch (trigger.type) {
      case 'schedule':
        this.startCron(automation, trigger as ScheduleTrigger);
        break;
      case 'manual':
      case 'webhook.received':
        // Manual triggers are invoked via API, no polling needed
        // Webhook triggers are handled by the webhook endpoint
        break;
      default:
        // All event-based triggers use polling
        this.startPolling(automation, trigger);
        break;
    }
  }

  /**
   * Stop watching a specific automation.
   */
  stopOne(automationId: string): void {
    const interval = this.pollingIntervals.get(automationId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(automationId);
    }

    const cron = this.cronJobs.get(automationId);
    if (cron) {
      cron.stop();
      this.cronJobs.delete(automationId);
    }
  }

  /**
   * Stop all triggers.
   */
  stopAll(): void {
    this.running = false;

    for (const [id, interval] of this.pollingIntervals) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();

    for (const [id, cron] of this.cronJobs) {
      cron.stop();
    }
    this.cronJobs.clear();

    logger.info('Trigger manager stopped');
  }

  /**
   * Handle a manual trigger invocation.
   */
  async handleManualTrigger(automation: AutomationRule, parameters?: Record<string, any>): Promise<void> {
    const event: TriggerEvent = {
      type: 'manual',
      automationId: automation.id,
      timestamp: new Date().toISOString(),
      manualParameters: parameters,
    };

    await this.handler(event);
  }

  /**
   * Handle an inbound webhook.
   */
  async handleWebhookTrigger(automation: AutomationRule, payload: Record<string, any>): Promise<void> {
    const event: TriggerEvent = {
      type: 'webhook.received',
      automationId: automation.id,
      timestamp: new Date().toISOString(),
      webhookPayload: payload,
    };

    await this.handler(event);
  }

  // ===========================================================================
  // Polling
  // ===========================================================================

  private startPolling(automation: AutomationRule, trigger: TriggerConfig): void {
    const intervalMs = Math.max(this.config.defaultPollIntervalMs, this.config.minPollIntervalMs);

    // Run immediately on start, then on interval
    this.pollOnce(automation, trigger).catch((err) =>
      logger.error(`Initial poll failed for ${automation.id}: ${err.message}`)
    );

    const interval = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.pollOnce(automation, trigger);
      } catch (err: any) {
        logger.error(`Poll failed for automation ${automation.id}: ${err.message}`);
      }
    }, intervalMs);

    this.pollingIntervals.set(automation.id, interval);
  }

  private async pollOnce(automation: AutomationRule, trigger: TriggerConfig): Promise<void> {
    // Get or create trigger state
    let state = await this.prisma.triggerState.findUnique({
      where: { automationId: automation.id },
    });

    if (!state) {
      state = await this.prisma.triggerState.create({
        data: {
          automationId: automation.id,
          lastCheckedAt: new Date(),
          lastSeenData: {},
        },
      });
    }

    const lastCheckedAt = state.lastCheckedAt;
    const lastSeenData = (state.lastSeenData as Record<string, any>) || {};

    switch (trigger.type) {
      case 'item.created':
        await this.pollItemCreated(automation, trigger as ItemCreatedTrigger, lastCheckedAt, lastSeenData);
        break;
      case 'item.updated':
        await this.pollItemUpdated(automation, trigger as ItemUpdatedTrigger, lastCheckedAt, lastSeenData);
        break;
      case 'attribute.changed':
        await this.pollAttributeChanged(automation, trigger as AttributeChangedTrigger, lastCheckedAt, lastSeenData);
        break;
      case 'status.changed':
        await this.pollStatusChanged(automation, trigger as StatusChangedTrigger, lastCheckedAt, lastSeenData);
        break;
      case 'oql.match':
        await this.pollOqlMatch(automation, trigger as OqlMatchTrigger, lastSeenData);
        break;
      // item.deleted and reference.added handled similarly
    }

    // Update trigger state
    await this.prisma.triggerState.update({
      where: { automationId: automation.id },
      data: { lastCheckedAt: new Date() },
    });
  }

  private async pollItemCreated(
    automation: AutomationRule,
    trigger: ItemCreatedTrigger,
    lastChecked: Date,
    lastSeen: Record<string, any>
  ): Promise<void> {
    const catalogId = trigger.catalogId || await this.resolveCatalogId(trigger.catalogName, automation.workspaceId);
    if (!catalogId) return;

    const result = await this.onstaqClient.listItems({
      catalogId,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 20,
    });

    for (const item of result.data) {
      const createdAt = new Date(item.createdAt);
      if (createdAt > lastChecked) {
        // Dedup check
        const hash = this.hashEvent(`item.created:${item.id}`);
        if (lastSeen[hash]) continue;

        const event: TriggerEvent = {
          type: 'item.created',
          automationId: automation.id,
          timestamp: new Date().toISOString(),
          item,
        };

        await this.handler(event);
        lastSeen[hash] = true;

        // Save dedup state
        await this.prisma.triggerState.update({
          where: { automationId: automation.id },
          data: { lastSeenData: lastSeen },
        });
      }
    }
  }

  private async pollItemUpdated(
    automation: AutomationRule,
    trigger: ItemUpdatedTrigger,
    lastChecked: Date,
    lastSeen: Record<string, any>
  ): Promise<void> {
    const catalogId = trigger.catalogId || await this.resolveCatalogId(trigger.catalogName, automation.workspaceId);
    if (!catalogId) return;

    const result = await this.onstaqClient.listItems({
      catalogId,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      limit: 20,
    });

    for (const item of result.data) {
      const updatedAt = new Date(item.updatedAt);
      if (updatedAt > lastChecked) {
        // If specific attributes are being watched, check history
        if (trigger.attributes?.length) {
          const history = await this.onstaqClient.getHistory(item.id);
          const recentChanges = history.filter((h) => new Date(h.createdAt) > lastChecked && h.action === 'UPDATED');

          const relevant = recentChanges.some((h) => {
            const changedFields = Object.keys(h.changes || {});
            return trigger.attributes!.some((a) => changedFields.includes(a));
          });

          if (!relevant) continue;
        }

        const hash = this.hashEvent(`item.updated:${item.id}:${item.updatedAt}`);
        if (lastSeen[hash]) continue;

        // Get previous values from history
        const history = await this.onstaqClient.getHistory(item.id);
        const latestChange = history.find((h) => h.action === 'UPDATED');
        const previousValues: Record<string, any> = {};

        if (latestChange?.changes) {
          for (const [field, change] of Object.entries(latestChange.changes as Record<string, any>)) {
            if (change && typeof change === 'object' && 'from' in change) {
              previousValues[field] = change.from;
            }
          }
        }

        const event: TriggerEvent = {
          type: 'item.updated',
          automationId: automation.id,
          timestamp: new Date().toISOString(),
          item,
          previousValues,
        };

        await this.handler(event);
        lastSeen[hash] = true;

        await this.prisma.triggerState.update({
          where: { automationId: automation.id },
          data: { lastSeenData: lastSeen },
        });
      }
    }
  }

  private async pollAttributeChanged(
    automation: AutomationRule,
    trigger: AttributeChangedTrigger,
    lastChecked: Date,
    lastSeen: Record<string, any>
  ): Promise<void> {
    // Reuse the item.updated logic but filter on specific attribute
    const updatedTrigger: ItemUpdatedTrigger = {
      type: 'item.updated',
      catalogId: trigger.catalogId,
      catalogName: trigger.catalogName,
      attributes: [trigger.attributeName],
    };

    await this.pollItemUpdated(automation, updatedTrigger, lastChecked, lastSeen);
  }

  private async pollStatusChanged(
    automation: AutomationRule,
    trigger: StatusChangedTrigger,
    lastChecked: Date,
    lastSeen: Record<string, any>
  ): Promise<void> {
    // Status is just an attribute — find the STATUS attribute and poll for changes
    const catalogId = trigger.catalogId || await this.resolveCatalogId(trigger.catalogName, automation.workspaceId);
    if (!catalogId) return;

    const attributes = await this.onstaqClient.listAttributes(catalogId);
    const statusAttr = attributes.find((a) => a.type === 'STATUS');
    if (!statusAttr) return;

    const changedTrigger: AttributeChangedTrigger = {
      type: 'attribute.changed',
      catalogId,
      attributeName: statusAttr.name,
      from: trigger.from,
      to: trigger.to,
    };

    await this.pollAttributeChanged(automation, changedTrigger, lastChecked, lastSeen);
  }

  private async pollOqlMatch(
    automation: AutomationRule,
    trigger: OqlMatchTrigger,
    lastSeen: Record<string, any>
  ): Promise<void> {
    try {
      const result = await this.onstaqClient.executeOql(trigger.query, automation.workspaceId);
      const currentCount = result.totalCount;
      const prevCount = lastSeen.oqlCount ?? -1;

      let shouldTrigger = false;

      switch (trigger.triggerOn) {
        case 'any_results':
          shouldTrigger = currentCount > 0;
          break;
        case 'new_results':
          shouldTrigger = currentCount > prevCount && prevCount >= 0;
          break;
        case 'count_change':
          shouldTrigger = currentCount !== prevCount && prevCount >= 0;
          break;
      }

      if (shouldTrigger) {
        const event: TriggerEvent = {
          type: 'oql.match',
          automationId: automation.id,
          timestamp: new Date().toISOString(),
          oqlResults: result.rows,
        };

        await this.handler(event);
      }

      // Update count in state
      await this.prisma.triggerState.update({
        where: { automationId: automation.id },
        data: { lastSeenData: { ...lastSeen, oqlCount: currentCount } },
      });
    } catch (err: any) {
      logger.error(`OQL poll failed for automation ${automation.id}: ${err.message}`);
    }
  }

  // ===========================================================================
  // Cron scheduling
  // ===========================================================================

  private startCron(automation: AutomationRule, trigger: ScheduleTrigger): void {
    try {
      const job = new CronJob(
        trigger.cron,
        async () => {
          if (!this.running) return;

          const event: TriggerEvent = {
            type: 'schedule',
            automationId: automation.id,
            timestamp: new Date().toISOString(),
            scheduleTime: new Date().toISOString(),
          };

          try {
            await this.handler(event);
          } catch (err: any) {
            logger.error(`Scheduled automation ${automation.id} failed: ${err.message}`);
          }
        },
        null,
        true,
        trigger.timezone || 'UTC'
      );

      this.cronJobs.set(automation.id, job);
      logger.info(`Cron job started for automation ${automation.id}: ${trigger.cron}`);
    } catch (err: any) {
      logger.error(`Failed to create cron job for ${automation.id}: ${err.message}`);
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private async resolveCatalogId(catalogName: string | undefined, workspaceId: string): Promise<string | undefined> {
    if (!catalogName) return undefined;
    const catalogs = await this.onstaqClient.listCatalogs(workspaceId);
    return catalogs.find((c) => c.name.toLowerCase() === catalogName.toLowerCase())?.id;
  }

  private hashEvent(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex').slice(0, 12);
  }
}

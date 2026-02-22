// =============================================================================
// ONSTAQ Execution Sync
// Optionally logs execution history back into ONSTAQ as items
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { logger } from '../utils/logger';

const SYNC_CATALOG_NAME = 'Automation Logs';
const SYNC_CATALOG_ICON = 'zap';

interface SyncConfig {
  enabled: boolean;
  workspaceId: string;
  catalogId?: string; // Will be auto-created if not set
}

export class OnstaqExecutionSync {
  private prisma: PrismaClient;
  private onstaqClient: OnstaqClient;
  private config: SyncConfig;
  private catalogId: string | null = null;

  constructor(prisma: PrismaClient, onstaqClient: OnstaqClient, config: SyncConfig) {
    this.prisma = prisma;
    this.onstaqClient = onstaqClient;
    this.config = config;
  }

  /**
   * Initialize: ensure the Automation Logs catalog exists in the workspace.
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    if (this.config.catalogId) {
      this.catalogId = this.config.catalogId;
      return;
    }

    try {
      // Check if catalog already exists
      const catalogs = await this.onstaqClient.listCatalogs(this.config.workspaceId);
      const existing = catalogs.find((c) => c.name === SYNC_CATALOG_NAME);

      if (existing) {
        this.catalogId = existing.id;
        logger.info(`ONSTAQ sync: Using existing "${SYNC_CATALOG_NAME}" catalog (${existing.id})`);
        return;
      }

      // Create the catalog
      const catalog = await this.onstaqClient.createCatalog({
        workspaceId: this.config.workspaceId,
        name: SYNC_CATALOG_NAME,
        description: 'Automatic log of automation executions',
        icon: SYNC_CATALOG_ICON,
      });
      this.catalogId = catalog.id;

      // Add attributes
      const attributeDefs = [
        { name: 'Automation', type: 'TEXT' as const, isRequired: true },
        { name: 'Trigger Type', type: 'TEXT' as const },
        { name: 'Execution Status', type: 'STATUS' as const, config: { options: ['SUCCESS', 'FAILED', 'SKIPPED'] } },
        { name: 'Duration (ms)', type: 'INTEGER' as const },
        { name: 'Actions Executed', type: 'INTEGER' as const },
        { name: 'Error', type: 'TEXTAREA' as const },
        { name: 'Details', type: 'TEXTAREA' as const },
        { name: 'Executed At', type: 'DATETIME' as const },
      ];

      for (const attr of attributeDefs) {
        await this.onstaqClient.createAttribute({
          catalogId: this.catalogId,
          name: attr.name,
          type: attr.type,
          isRequired: attr.isRequired || false,
          config: attr.config,
        });
      }

      logger.info(`ONSTAQ sync: Created "${SYNC_CATALOG_NAME}" catalog with attributes`);
    } catch (err: any) {
      logger.error(`ONSTAQ sync initialization failed: ${err.message}`);
      this.config.enabled = false; // Disable sync to prevent repeated failures
    }
  }

  /**
   * Sync a completed execution back to ONSTAQ as an item.
   */
  async syncExecution(executionId: string): Promise<void> {
    if (!this.config.enabled || !this.catalogId) return;

    try {
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { automation: { select: { name: true } } },
      });

      if (!execution) return;

      const triggerData = execution.triggerData as any;
      const componentResults = (execution.componentResults as any[]) || [];

      await this.onstaqClient.createItem(this.catalogId, {
        'Name': `${execution.automation.name} — ${execution.status}`,
        'Automation': execution.automation.name,
        'Trigger Type': triggerData?.type || 'unknown',
        'Execution Status': execution.status,
        'Duration (ms)': execution.durationMs?.toString() || '0',
        'Actions Executed': componentResults.length.toString(),
        'Error': execution.error || '',
        'Details': JSON.stringify({
          executionId: execution.id,
          triggerSummary: triggerData?.type,
          itemKey: triggerData?.item?.key,
          actionSummary: componentResults.map((a: any) => `${a.actionType}: ${a.status}`),
        }, null, 2),
        'Executed At': execution.startedAt.toISOString(),
      });

      logger.debug(`ONSTAQ sync: Logged execution ${executionId}`);
    } catch (err: any) {
      logger.error(`ONSTAQ sync failed for execution ${executionId}: ${err.message}`);
      // Don't throw — sync failures shouldn't break the engine
    }
  }
}

// =============================================================================
// Express API Server
// Main REST API server for ONSTAQ Automations
// =============================================================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { AutomationExecutor } from '../engine/executor';
import { createAuthMiddleware } from './middleware/auth';
import { createAutomationsRouter } from './routes/automations';
import { createExecutionsRouter } from './routes/executions';
import { createWebhooksRouter } from './routes/webhooks';
import { logger } from '../utils/logger';

export function createApiServer(
  prisma: PrismaClient,
  onstaqClient: OnstaqClient,
  executor: AutomationExecutor
): express.Application {
  const app = express();

  // --- Global Middleware ---
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // --- Health Check (public) ---
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'onstaq-automations',
      timestamp: new Date().toISOString(),
    });
  });

  // --- Webhook routes (no auth — use HMAC signatures instead) ---
  app.use('/api/webhooks', createWebhooksRouter(prisma, executor));

  // --- Authenticated routes ---
  const auth = createAuthMiddleware(onstaqClient);

  app.use('/api/automations', auth, createAutomationsRouter(prisma, executor));
  app.use('/api/executions', auth, createExecutionsRouter(prisma));

  // --- Schema introspection endpoint (useful for MCP and clients) ---
  app.get('/api/schema/triggers', auth, (req, res) => {
    res.json({
      triggers: [
        { type: 'item.created', description: 'Fires when a new item is created in a catalog', requiredFields: [], optionalFields: ['catalogId', 'catalogName'] },
        { type: 'item.updated', description: 'Fires when an item is updated', requiredFields: [], optionalFields: ['catalogId', 'catalogName', 'attributes'] },
        { type: 'item.deleted', description: 'Fires when an item is deleted', requiredFields: [], optionalFields: ['catalogId', 'catalogName'] },
        { type: 'attribute.changed', description: 'Fires when a specific attribute changes value', requiredFields: ['attributeName'], optionalFields: ['catalogId', 'catalogName', 'from', 'to'] },
        { type: 'status.changed', description: 'Fires when a STATUS attribute transitions', requiredFields: [], optionalFields: ['catalogId', 'catalogName', 'from', 'to'] },
        { type: 'reference.added', description: 'Fires when a reference is added to an item', requiredFields: [], optionalFields: ['catalogId', 'catalogName', 'referenceKind'] },
        { type: 'schedule', description: 'Fires on a cron schedule', requiredFields: ['cron'], optionalFields: ['timezone'] },
        { type: 'manual', description: 'Fires when manually triggered via API or MCP', requiredFields: [], optionalFields: ['parameters'] },
        { type: 'oql.match', description: 'Fires when an OQL query matches results', requiredFields: ['query', 'triggerOn'], optionalFields: ['interval'] },
        { type: 'webhook.received', description: 'Fires when an external webhook is received', requiredFields: [], optionalFields: ['path', 'secret', 'filter'] },
      ]
    });
  });

  app.get('/api/schema/actions', auth, (req, res) => {
    res.json({
      actions: [
        { type: 'item.create', description: 'Create a new item in a catalog' },
        { type: 'item.update', description: 'Update item attributes' },
        { type: 'item.delete', description: 'Delete an item' },
        { type: 'attribute.set', description: 'Set a specific attribute value on an item' },
        { type: 'reference.add', description: 'Create a reference between items' },
        { type: 'reference.remove', description: 'Remove a reference from an item' },
        { type: 'comment.add', description: 'Add a comment to an item' },
        { type: 'item.import', description: 'Bulk import items into a catalog' },
        { type: 'catalog.create', description: 'Create a new catalog' },
        { type: 'attribute.create', description: 'Add an attribute to a catalog' },
        { type: 'workspace.member.add', description: 'Add a member to a workspace' },
        { type: 'oql.execute', description: 'Execute an OQL query' },
        { type: 'webhook.send', description: 'Send an HTTP request to an external URL' },
        { type: 'automation.trigger', description: 'Chain-trigger another automation' },
      ]
    });
  });

  app.get('/api/schema/conditions', auth, (req, res) => {
    res.json({
      operators: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
        'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal',
        'in', 'not_in', 'is_null', 'is_not_null', 'changed_to', 'changed_from', 'matches_regex'],
      conditionTypes: [
        { type: 'attribute', description: 'Compare an item attribute value' },
        { type: 'oql', description: 'Run an OQL query — passes if results found' },
        { type: 'reference', description: 'Check if item has references' },
        { type: 'template', description: 'Evaluate a template expression as truthy/falsy' },
      ],
      logicalOperators: ['AND', 'OR', 'NOT'],
      templateVariables: [
        '{{trigger.item.id}}', '{{trigger.item.key}}', '{{trigger.item.attributes.FieldName}}',
        '{{trigger.previous.FieldName}}', '{{trigger.user.name}}', '{{trigger.timestamp}}',
        '{{env.NOW}}', '{{env.TODAY}}', '{{context.variables.name}}',
        '{{oql:FROM Catalog WHERE ... SELECT COUNT(*)}}',
      ],
    });
  });

  // --- 404 handler ---
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` } });
  });

  // --- Global error handler ---
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}

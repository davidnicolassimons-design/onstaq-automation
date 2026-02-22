// =============================================================================
// Webhook Routes
// Inbound webhook receiver for external triggers and future ONSTAQ events
// =============================================================================

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AutomationExecutor } from '../../engine/executor';
import { AutomationRule, WebhookReceivedTrigger } from '../../engine/types';
import { logger } from '../../utils/logger';
import crypto from 'crypto';

export function createWebhooksRouter(prisma: PrismaClient, executor: AutomationExecutor): Router {
  const router = Router();

  // ---- Generic inbound webhook ----
  // POST /api/webhooks/inbound/:path?
  router.post('/inbound/:path?', async (req: Request, res: Response) => {
    try {
      const path = req.params.path || '';
      const payload = req.body;

      logger.info(`Webhook received on path: /inbound/${path}`);

      // Find automations with webhook.received triggers matching this path
      const automations = await prisma.automation.findMany({
        where: { enabled: true },
      });

      const matching = automations.filter((a: any) => {
        const trigger = a.trigger as any;
        if (trigger.type !== 'webhook.received') return false;
        if (trigger.path && trigger.path !== path) return false;
        return true;
      });

      if (matching.length === 0) {
        return res.status(200).json({ message: 'No matching automations', processed: 0 });
      }

      // Validate HMAC signatures if configured
      const results: any[] = [];
      for (const automation of matching) {
        const trigger = automation.trigger as unknown as WebhookReceivedTrigger;

        // HMAC validation
        if (trigger.secret) {
          const signature = req.headers['x-webhook-signature'] as string;
          if (!signature) {
            results.push({ automationId: automation.id, status: 'skipped', reason: 'Missing signature' });
            continue;
          }

          const expected = crypto
            .createHmac('sha256', trigger.secret)
            .update(JSON.stringify(payload))
            .digest('hex');

          if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            results.push({ automationId: automation.id, status: 'skipped', reason: 'Invalid signature' });
            continue;
          }
        }

        // Filter check
        if (trigger.filter) {
          const matches = Object.entries(trigger.filter).every(([key, value]) => payload[key] === value);
          if (!matches) {
            results.push({ automationId: automation.id, status: 'skipped', reason: 'Filter mismatch' });
            continue;
          }
        }

        // Execute
        try {
          const rule: AutomationRule = {
            id: automation.id,
            name: automation.name,
            description: automation.description || undefined,
            workspaceId: automation.workspaceId,
            workspaceKey: automation.workspaceKey || undefined,
            enabled: automation.enabled,
            trigger: automation.trigger as any,
            components: (automation as any).components as any,
            executionOrder: automation.executionOrder,
            createdBy: automation.createdBy,
            createdAt: automation.createdAt.toISOString(),
            updatedAt: automation.updatedAt.toISOString(),
          };

          await executor.triggerManually(rule.id, payload);
          results.push({ automationId: automation.id, status: 'triggered' });
        } catch (err: any) {
          results.push({ automationId: automation.id, status: 'error', error: err.message });
        }
      }

      res.status(200).json({ processed: matching.length, results });
    } catch (err: any) {
      logger.error(`Webhook handler error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- Future: ONSTAQ native event webhook ----
  // This endpoint will receive events directly from ONSTAQ when native events are added
  router.post('/onstaq', async (req: Request, res: Response) => {
    try {
      const event = req.body;
      logger.info(`ONSTAQ event received: ${event.type || 'unknown'}`);

      // TODO: When ONSTAQ adds native events, route them to matching automations

      res.status(200).json({ received: true });
    } catch (err: any) {
      logger.error(`ONSTAQ webhook error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

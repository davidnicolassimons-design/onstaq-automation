// =============================================================================
// Automations REST API Routes
// CRUD + execute + test for automation rules
// =============================================================================

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { AutomationExecutor } from '../../engine/executor';
import {
  createAutomationSchema,
  updateAutomationSchema,
  executeAutomationSchema,
  testAutomationSchema
} from '../validation';
import { logger } from '../../utils/logger';

export function createAutomationsRouter(prisma: PrismaClient, executor: AutomationExecutor): Router {
  const router = Router();

  // ---- LIST automations ----
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { workspaceId, enabled } = req.query;

      const where: any = {};
      if (workspaceId) where.workspaceId = workspaceId;
      if (enabled !== undefined) where.enabled = enabled === 'true';

      const automations = await prisma.automation.findMany({
        where,
        orderBy: { executionOrder: 'asc' },
        include: {
          _count: { select: { executions: true } },
        },
      });

      res.json(automations);
    } catch (err: any) {
      logger.error(`List automations error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- GET single automation ----
  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const automation = await prisma.automation.findUnique({
        where: { id: req.params.id },
        include: {
          executions: {
            take: 10,
            orderBy: { startedAt: 'desc' },
          },
          _count: { select: { executions: true } },
        },
      });

      if (!automation) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });
      }

      res.json(automation);
    } catch (err: any) {
      logger.error(`Get automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- CREATE automation ----
  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = createAutomationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Validation failed', details: parsed.error.issues }
        });
      }

      const data = parsed.data;
      const automation = await prisma.automation.create({
        data: {
          name: data.name,
          description: data.description,
          workspaceId: data.workspaceId,
          workspaceKey: data.workspaceKey,
          enabled: data.enabled,
          trigger: data.trigger as any,
          conditions: data.conditions as any,
          actions: data.actions as any,
          executionOrder: data.executionOrder,
          createdBy: req.user!.id,
        },
      });

      // Register triggers if enabled
      if (automation.enabled) {
        await executor.reloadAutomation(automation.id);
      }

      logger.info(`Automation created: ${automation.id} (${automation.name})`);
      res.status(201).json(automation);
    } catch (err: any) {
      logger.error(`Create automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- UPDATE automation ----
  router.put('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await prisma.automation.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });
      }

      const parsed = updateAutomationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Validation failed', details: parsed.error.issues }
        });
      }

      const data = parsed.data;
      const updateData: any = {};
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.enabled !== undefined) updateData.enabled = data.enabled;
      if (data.trigger !== undefined) updateData.trigger = data.trigger;
      if (data.conditions !== undefined) updateData.conditions = data.conditions;
      if (data.actions !== undefined) updateData.actions = data.actions;
      if (data.executionOrder !== undefined) updateData.executionOrder = data.executionOrder;

      const automation = await prisma.automation.update({
        where: { id: req.params.id },
        data: updateData,
      });

      // Reload triggers
      await executor.reloadAutomation(automation.id);

      logger.info(`Automation updated: ${automation.id}`);
      res.json(automation);
    } catch (err: any) {
      logger.error(`Update automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- DELETE automation ----
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const existing = await prisma.automation.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Automation not found' } });
      }

      const id = req.params.id as string;
      await prisma.automation.delete({ where: { id } });

      // Stop triggers
      await executor.reloadAutomation(id);

      logger.info(`Automation deleted: ${id}`);
      res.json({ message: 'Automation deleted' });
    } catch (err: any) {
      logger.error(`Delete automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- ENABLE automation ----
  router.post('/:id/enable', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const automation = await prisma.automation.update({
        where: { id: req.params.id },
        data: { enabled: true },
      });

      await executor.reloadAutomation(automation.id);
      res.json(automation);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- DISABLE automation ----
  router.post('/:id/disable', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const automation = await prisma.automation.update({
        where: { id: req.params.id },
        data: { enabled: false },
      });

      await executor.reloadAutomation(automation.id);
      res.json(automation);
    } catch (err: any) {
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- EXECUTE automation manually ----
  router.post('/:id/execute', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = executeAutomationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Validation failed', details: parsed.error.issues }
        });
      }

      const executionId = await executor.triggerManually(req.params.id as string, parsed.data.parameters);
      const execution = await prisma.execution.findUnique({ where: { id: executionId } });

      res.json(execution);
    } catch (err: any) {
      logger.error(`Execute automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- TEST (dry-run) automation ----
  router.post('/:id/test', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = testAutomationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'Validation failed', details: parsed.error.issues }
        });
      }

      const result = await executor.testAutomation(req.params.id as string, parsed.data.mockTriggerData);
      res.json(result);
    } catch (err: any) {
      logger.error(`Test automation error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

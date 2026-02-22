// =============================================================================
// Executions REST API Routes
// View execution history and details
// =============================================================================

import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../../utils/logger';

export function createExecutionsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // ---- LIST executions ----
  router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        automationId,
        status,
        page = '1',
        limit = '25',
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10)));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};
      if (automationId) where.automationId = automationId;
      if (status) where.status = status;

      const [data, total] = await Promise.all([
        prisma.execution.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: limitNum,
          include: {
            automation: {
              select: { id: true, name: true, workspaceId: true },
            },
          },
        }),
        prisma.execution.count({ where }),
      ]);

      res.json({
        data,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      });
    } catch (err: any) {
      logger.error(`List executions error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- GET execution details ----
  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const execution = await prisma.execution.findUnique({
        where: { id: req.params.id as string },
        include: {
          automation: {
            select: { id: true, name: true, workspaceId: true, trigger: true },
          },
        },
      });

      if (!execution) {
        return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execution not found' } });
      }

      res.json(execution);
    } catch (err: any) {
      logger.error(`Get execution error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  // ---- GET execution stats for an automation ----
  router.get('/stats/:automationId', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { automationId } = req.params;
      const { since } = req.query;

      const where: any = { automationId };
      if (since) {
        where.startedAt = { gte: new Date(since as string) };
      }

      const [total, success, failed, skipped, avgDuration] = await Promise.all([
        prisma.execution.count({ where }),
        prisma.execution.count({ where: { ...where, status: 'SUCCESS' } }),
        prisma.execution.count({ where: { ...where, status: 'FAILED' } }),
        prisma.execution.count({ where: { ...where, status: 'SKIPPED' } }),
        prisma.execution.aggregate({
          where: { ...where, durationMs: { not: null } },
          _avg: { durationMs: true },
        }),
      ]);

      res.json({
        automationId,
        total,
        success,
        failed,
        skipped,
        avgDurationMs: Math.round(avgDuration._avg.durationMs || 0),
        successRate: total > 0 ? Math.round((success / total) * 100) : 0,
      });
    } catch (err: any) {
      logger.error(`Execution stats error: ${err.message}`);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
    }
  });

  return router;
}

// =============================================================================
// ONSTAQ Automations — Main Entry Point
// Starts REST API server, automation engine, and MCP HTTP transport
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from './onstaq/client';
import { AutomationExecutor } from './engine/executor';
import { createApiServer } from './api/server';
import { createMcpServer, createHttpTransport, mountMcpRoutes } from './mcp/server';
import { logger } from './utils/logger';

async function main() {
  // --- Environment ---
  const PORT = parseInt(process.env.PORT || '3100', 10);
  const MCP_HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || '3101', 10);
  const ONSTAQ_API_URL = process.env.ONSTAQ_API_URL || 'http://localhost:3000/api/v1';
  const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
  const MIN_POLL_INTERVAL_MS = parseInt(process.env.MIN_POLL_INTERVAL_MS || '10000', 10);
  const MAX_CONCURRENT_EXECUTIONS = parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '10', 10);

  // --- Initialize services ---
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Database connected');

  const onstaqClient = new OnstaqClient({
    baseUrl: ONSTAQ_API_URL,
    email: process.env.ONSTAQ_SERVICE_EMAIL,
    password: process.env.ONSTAQ_SERVICE_PASSWORD,
  });

  const executor = new AutomationExecutor(prisma, onstaqClient, {
    maxConcurrentExecutions: MAX_CONCURRENT_EXECUTIONS,
    pollIntervalMs: POLL_INTERVAL_MS,
    minPollIntervalMs: MIN_POLL_INTERVAL_MS,
  });

  // --- Start automation engine ---
  try {
    await executor.start();
    logger.info('Automation engine started');
  } catch (err: any) {
    logger.warn(`Automation engine start delayed: ${err.message}`);
    logger.warn('Engine will retry on next trigger check. REST API still available.');
  }

  // --- Start REST API ---
  const apiApp = createApiServer(prisma, onstaqClient, executor);

  // --- MCP setup ---
  const mcpServer = createMcpServer(prisma, onstaqClient, executor);

  // Single-port mode: mount MCP on the main Express app (default for Railway / production).
  // Separate-port mode: when MCP_HTTP_PORT is explicitly set and differs from PORT.
  const useSeparateMcpPort = process.env.MCP_HTTP_PORT && MCP_HTTP_PORT !== PORT;

  if (useSeparateMcpPort) {
    const mcpApp = createHttpTransport(mcpServer, MCP_HTTP_PORT);
    mcpApp.listen(MCP_HTTP_PORT, () => {
      logger.info(`MCP HTTP transport listening on port ${MCP_HTTP_PORT}`);
      logger.info(`  MCP endpoint: http://localhost:${MCP_HTTP_PORT}/mcp`);
    });
  } else {
    mountMcpRoutes(apiApp, mcpServer);
    logger.info('MCP HTTP transport mounted on main server at /mcp');
  }

  apiApp.listen(PORT, () => {
    logger.info(`REST API listening on port ${PORT}`);
    logger.info(`  Health: http://localhost:${PORT}/api/health`);
    logger.info(`  Automations: http://localhost:${PORT}/api/automations`);
    logger.info(`  Executions: http://localhost:${PORT}/api/executions`);
    if (!useSeparateMcpPort) {
      logger.info(`  MCP endpoint: http://localhost:${PORT}/mcp`);
    }
  });

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received. Shutting down...`);
    await executor.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(`Fatal error: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

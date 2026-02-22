// =============================================================================
// MCP Stdio Entry Point
// Standalone entry for running MCP server via stdio transport
// (for Claude Desktop, local AI agents)
// =============================================================================

import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { AutomationExecutor } from '../engine/executor';
import { createMcpServer, startStdioTransport } from './server';
import { logger } from '../utils/logger';

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  const onstaqClient = new OnstaqClient({
    baseUrl: process.env.ONSTAQ_API_URL || 'http://localhost:3000/api/v1',
    email: process.env.ONSTAQ_SERVICE_EMAIL,
    password: process.env.ONSTAQ_SERVICE_PASSWORD,
  });

  const executor = new AutomationExecutor(prisma, onstaqClient);

  // Attempt to start engine (won't fail if ONSTAQ is unreachable)
  try {
    await executor.start();
  } catch (err: any) {
    logger.warn(`Engine start delayed: ${err.message}`);
  }

  const mcpServer = createMcpServer(prisma, onstaqClient, executor);
  await startStdioTransport(mcpServer);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await executor.stop();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`MCP stdio fatal error: ${err.message}`);
  process.exit(1);
});

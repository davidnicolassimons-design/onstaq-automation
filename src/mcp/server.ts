// =============================================================================
// MCP Server
// Model Context Protocol server with stdio and Streamable HTTP transports
// =============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { AutomationExecutor } from '../engine/executor';
import { createMcpTools } from './tools';
import { logger } from '../utils/logger';
import express from 'express';
import { z } from 'zod';

/**
 * Create and configure the MCP server with all tools.
 */
export function createMcpServer(
  prisma: PrismaClient,
  onstaqClient: OnstaqClient,
  executor: AutomationExecutor
): McpServer {
  const server = new McpServer({
    name: 'onstaq-automations',
    version: '1.0.0',
  });

  // Register all tools
  const tools = createMcpTools(prisma, onstaqClient, executor);

  for (const tool of tools) {
    // Convert Zod schema to the format MCP SDK expects
    const shape = tool.inputSchema instanceof z.ZodObject
      ? tool.inputSchema.shape
      : {};

    server.tool(
      tool.name,
      tool.description,
      shape,
      async (input: any) => {
        try {
          const result = await tool.handler(input);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err: any) {
          logger.error(`MCP tool "${tool.name}" error: ${err.message}`);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: err.message }),
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  // Register resources
  server.resource(
    'automation',
    'automation://{automationId}',
    async (uri) => {
      const id = uri.pathname.replace('//', '');
      const automation = await prisma.automation.findUnique({
        where: { id },
        include: { _count: { select: { executions: true } } },
      });

      if (!automation) {
        return {
          contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ error: 'Not found' }) }],
        };
      }

      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(automation, null, 2) }],
      };
    }
  );

  return server;
}

/**
 * Start MCP server with stdio transport (for Claude Desktop / local agents).
 */
export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server running on stdio transport');
}

/**
 * Mount MCP Streamable HTTP routes on an existing Express app.
 * Used in single-port mode (e.g., Railway deployment).
 */
export function mountMcpRoutes(app: express.Application, server: McpServer): void {
  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on('close', () => {
        transport.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err: any) {
      logger.error(`MCP HTTP transport error: ${err.message}`);
      res.status(500).json({ error: 'MCP transport error' });
    }
  });

  app.get('/mcp/health', (req, res) => {
    res.json({ status: 'ok', transport: 'streamable-http' });
  });
}

/**
 * Create a standalone Express app for MCP Streamable HTTP transport.
 * Used when running MCP on a dedicated port.
 */
export function createHttpTransport(server: McpServer, port: number): express.Application {
  const app = express();
  mountMcpRoutes(app, server);
  return app;
}

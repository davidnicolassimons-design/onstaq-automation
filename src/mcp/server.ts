// =============================================================================
// MCP Server
// Model Context Protocol server with stdio and Streamable HTTP transports
// =============================================================================

import crypto from 'crypto';
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
 * Start MCP server with Streamable HTTP transport (for remote agents).
 * Uses a persistent transport with session ID generation for concurrent stability.
 */
export function createHttpTransport(server: McpServer, port: number): express.Application {
  const app = express();

  // Track active sessions for proper cleanup
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post('/mcp', async (req, res) => {
    try {
      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions.has(sessionId)) {
        transport = sessions.get(sessionId)!;
      } else {
        // Create new transport with session ID generation
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        });

        await server.connect(transport);

        // Track session after connection
        const newSessionId = transport.sessionId;
        if (newSessionId) {
          sessions.set(newSessionId, transport);
          logger.debug(`MCP session created: ${newSessionId} (active: ${sessions.size})`);
        }

        // Clean up on transport close
        transport.onclose = () => {
          if (newSessionId) {
            sessions.delete(newSessionId);
            logger.debug(`MCP session closed: ${newSessionId} (active: ${sessions.size})`);
          }
        };
      }

      await transport.handleRequest(req, res);
    } catch (err: any) {
      logger.error(`MCP HTTP transport error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP transport error' });
      }
    }
  });

  // Handle GET for SSE streams
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: 'No active session. Send a POST first.' });
    }
  });

  // Handle DELETE for session cleanup
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.close();
      sessions.delete(sessionId);
      res.status(200).json({ status: 'session closed' });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // Health check for MCP endpoint
  app.get('/mcp/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'streamable-http', activeSessions: sessions.size });
  });

  return app;
}

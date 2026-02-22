# ONSTAQ Automations

Automation engine for [ONSTAQ](https://onstaq.com) — trigger-condition-action workflows for ONSTAQ workspaces, catalogs, and items.

## Features

- **10 trigger types**: item.created, item.updated, item.deleted, attribute.changed, status.changed, reference.added, schedule (cron), manual, oql.match, webhook.received
- **Composable conditions**: attribute comparisons, OQL queries, reference checks with AND/OR/NOT logic
- **14 action types**: create/update/delete items, manage references, add comments, execute OQL, send webhooks, chain automations
- **Template variables**: `{{trigger.item.key}}`, `{{trigger.previous.Status}}`, `{{env.NOW}}`, `{{oql:QUERY}}`
- **REST API**: Full CRUD for automations + execution history
- **MCP Server**: AI agent integration via stdio and Streamable HTTP transports
- **Execution sync**: Optionally log executions back into ONSTAQ as items

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your database URL and ONSTAQ API credentials

# Generate Prisma client and push schema
npx prisma generate
npx prisma db push

# Start (REST API + MCP HTTP + engine)
npm run dev
```

## Architecture

```
REST API (:3100)  ←→  Automation Engine  ←→  ONSTAQ API
MCP HTTP (:3101)  ←→  (trigger → condition → action)
MCP stdio         ←→
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/automations` | List automations |
| POST | `/api/automations` | Create automation |
| GET | `/api/automations/:id` | Get automation |
| PUT | `/api/automations/:id` | Update automation |
| DELETE | `/api/automations/:id` | Delete automation |
| POST | `/api/automations/:id/execute` | Manual trigger |
| POST | `/api/automations/:id/test` | Dry-run |
| GET | `/api/executions` | Execution history |
| GET | `/api/health` | Health check |

## MCP Integration

### Claude Desktop (stdio)
```json
{
  "mcpServers": {
    "onstaq-automations": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "ONSTAQ_API_URL": "https://..."
      }
    }
  }
}
```

### Remote agents (HTTP)
```
POST http://localhost:3101/mcp
```

## License

MIT

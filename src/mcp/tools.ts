// =============================================================================
// MCP Tool Definitions
// All tools exposed to AI agents via MCP
// =============================================================================

import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { OnstaqClient } from '../onstaq/client';
import { AutomationExecutor } from '../engine/executor';
import { logger } from '../utils/logger';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType<any>;
  handler: (input: any) => Promise<any>;
}

export function createMcpTools(
  prisma: PrismaClient,
  onstaqClient: OnstaqClient,
  executor: AutomationExecutor
): McpToolDefinition[] {
  return [
    // ======================================================================
    // Automation CRUD
    // ======================================================================
    {
      name: 'list_automations',
      description: 'List all automations, optionally filtered by workspace. Returns automation rules with their triggers, conditions, and actions.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().optional().describe('Filter by ONSTAQ workspace ID'),
        enabled: z.boolean().optional().describe('Filter by enabled/disabled status'),
      }),
      handler: async (input) => {
        const where: any = {};
        if (input.workspaceId) where.workspaceId = input.workspaceId;
        if (input.enabled !== undefined) where.enabled = input.enabled;

        const automations = await prisma.automation.findMany({
          where,
          orderBy: { executionOrder: 'asc' },
          include: { _count: { select: { executions: true } } },
        });

        return { automations, count: automations.length };
      },
    },

    {
      name: 'get_automation',
      description: 'Get full details of a specific automation including its trigger, conditions, actions, and recent executions.',
      inputSchema: z.object({
        automationId: z.string().uuid().describe('The automation ID'),
      }),
      handler: async (input) => {
        const automation = await prisma.automation.findUnique({
          where: { id: input.automationId },
          include: {
            executions: { take: 5, orderBy: { startedAt: 'desc' } },
            _count: { select: { executions: true } },
          },
        });
        if (!automation) throw new Error(`Automation not found: ${input.automationId}`);
        return automation;
      },
    },

    {
      name: 'create_automation',
      description: `Create a new automation rule with a trigger, optional conditions, and one or more actions.

TRIGGER TYPES: item.created, item.updated, item.deleted, attribute.changed, status.changed, reference.added, schedule (cron), manual, oql.match, webhook.received

CONDITION TYPES: attribute (compare values), oql (run query), reference (check refs exist), template (evaluate expression)
Conditions support AND/OR/NOT composition.

ACTION TYPES: item.create, item.update, item.delete, attribute.set, reference.add, reference.remove, comment.add, item.import, catalog.create, attribute.create, workspace.member.add, oql.execute, webhook.send, automation.trigger

Actions support {{template}} variables: {{trigger.item.id}}, {{trigger.item.key}}, {{trigger.item.attributes.FieldName}}, {{trigger.previous.FieldName}}, {{env.NOW}}, {{oql:QUERY}}`,
      inputSchema: z.object({
        name: z.string().describe('Human-readable name for this automation'),
        description: z.string().optional().describe('Description of what this automation does'),
        workspaceId: z.string().uuid().describe('ONSTAQ workspace ID this automation belongs to'),
        trigger: z.object({
          type: z.string().describe('Trigger type'),
        }).passthrough().describe('Trigger configuration'),
        conditions: z.any().optional().describe('Condition tree (single condition or AND/OR/NOT group)'),
        actions: z.array(z.object({
          type: z.string().describe('Action type'),
          name: z.string().optional(),
          continueOnError: z.boolean().optional(),
          config: z.record(z.any()),
        })).min(1).describe('Ordered list of actions to execute'),
        enabled: z.boolean().optional().default(true),
      }),
      handler: async (input) => {
        const automation = await prisma.automation.create({
          data: {
            name: input.name,
            description: input.description,
            workspaceId: input.workspaceId,
            enabled: input.enabled ?? true,
            trigger: input.trigger as any,
            conditions: input.conditions as any,
            actions: input.actions as any,
            createdBy: 'mcp-agent',
          },
        });

        if (automation.enabled) {
          await executor.reloadAutomation(automation.id);
        }

        return { id: automation.id, name: automation.name, message: 'Automation created successfully' };
      },
    },

    {
      name: 'update_automation',
      description: 'Update an existing automation. Only specified fields are changed.',
      inputSchema: z.object({
        automationId: z.string().uuid().describe('The automation ID to update'),
        name: z.string().optional(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
        trigger: z.any().optional(),
        conditions: z.any().optional(),
        actions: z.array(z.any()).optional(),
      }),
      handler: async (input) => {
        const { automationId, ...data } = input;
        const updateData: any = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.enabled !== undefined) updateData.enabled = data.enabled;
        if (data.trigger !== undefined) updateData.trigger = data.trigger;
        if (data.conditions !== undefined) updateData.conditions = data.conditions;
        if (data.actions !== undefined) updateData.actions = data.actions;

        const automation = await prisma.automation.update({
          where: { id: automationId },
          data: updateData,
        });

        await executor.reloadAutomation(automation.id);
        return { id: automation.id, name: automation.name, message: 'Automation updated' };
      },
    },

    {
      name: 'delete_automation',
      description: 'Permanently delete an automation and all its execution history.',
      inputSchema: z.object({
        automationId: z.string().uuid().describe('The automation ID to delete'),
      }),
      handler: async (input) => {
        await prisma.automation.delete({ where: { id: input.automationId } });
        await executor.reloadAutomation(input.automationId);
        return { message: 'Automation deleted', automationId: input.automationId };
      },
    },

    // ======================================================================
    // Enable / Disable
    // ======================================================================
    {
      name: 'enable_automation',
      description: 'Enable a disabled automation so it starts watching for triggers.',
      inputSchema: z.object({
        automationId: z.string().uuid(),
      }),
      handler: async (input) => {
        const automation = await prisma.automation.update({
          where: { id: input.automationId },
          data: { enabled: true },
        });
        await executor.reloadAutomation(automation.id);
        return { id: automation.id, enabled: true };
      },
    },

    {
      name: 'disable_automation',
      description: 'Disable an automation so it stops watching for triggers.',
      inputSchema: z.object({
        automationId: z.string().uuid(),
      }),
      handler: async (input) => {
        const automation = await prisma.automation.update({
          where: { id: input.automationId },
          data: { enabled: false },
        });
        await executor.reloadAutomation(automation.id);
        return { id: automation.id, enabled: false };
      },
    },

    // ======================================================================
    // Execute & Test
    // ======================================================================
    {
      name: 'execute_automation',
      description: 'Manually trigger an automation immediately, bypassing its normal trigger. Returns the execution result.',
      inputSchema: z.object({
        automationId: z.string().uuid(),
        parameters: z.record(z.any()).optional().describe('Optional parameters for manual triggers'),
      }),
      handler: async (input) => {
        const executionId = await executor.triggerManually(input.automationId, input.parameters);
        const execution = await prisma.execution.findUnique({ where: { id: executionId } });
        return execution;
      },
    },

    {
      name: 'test_automation',
      description: 'Dry-run an automation: evaluate conditions but do NOT execute actions. Returns what would happen.',
      inputSchema: z.object({
        automationId: z.string().uuid(),
        mockTriggerData: z.record(z.any()).optional().describe('Optional mock trigger data for testing'),
      }),
      handler: async (input) => {
        return executor.testAutomation(input.automationId, input.mockTriggerData);
      },
    },

    // ======================================================================
    // Execution History
    // ======================================================================
    {
      name: 'list_executions',
      description: 'View execution history for automations. Filter by automation ID or status.',
      inputSchema: z.object({
        automationId: z.string().uuid().optional(),
        status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED']).optional(),
        limit: z.number().max(50).optional().default(10),
      }),
      handler: async (input) => {
        const where: any = {};
        if (input.automationId) where.automationId = input.automationId;
        if (input.status) where.status = input.status;

        const executions = await prisma.execution.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          take: input.limit || 10,
          include: {
            automation: { select: { id: true, name: true } },
          },
        });

        return { executions, count: executions.length };
      },
    },

    {
      name: 'get_execution',
      description: 'Get full details of a specific execution including trigger data, condition results, and action results.',
      inputSchema: z.object({
        executionId: z.string().uuid(),
      }),
      handler: async (input) => {
        const execution = await prisma.execution.findUnique({
          where: { id: input.executionId },
          include: { automation: { select: { id: true, name: true, trigger: true } } },
        });
        if (!execution) throw new Error(`Execution not found: ${input.executionId}`);
        return execution;
      },
    },

    // ======================================================================
    // Schema Discovery (help AI agents understand the automation DSL)
    // ======================================================================
    {
      name: 'list_trigger_types',
      description: 'Show all available trigger types with their configuration options. Use this to understand what triggers are available when creating automations.',
      inputSchema: z.object({}),
      handler: async () => ({
        triggers: [
          { type: 'item.created', description: 'Fires when an item is created', config: { catalogId: 'optional UUID', catalogName: 'optional string' } },
          { type: 'item.updated', description: 'Fires when an item is updated', config: { catalogId: 'optional', catalogName: 'optional', attributes: 'optional string[] to watch specific attributes' } },
          { type: 'item.deleted', description: 'Fires when an item is deleted', config: { catalogId: 'optional', catalogName: 'optional' } },
          { type: 'attribute.changed', description: 'Fires when a specific attribute changes', config: { attributeName: 'required', catalogId: 'optional', from: 'optional old value', to: 'optional new value' } },
          { type: 'status.changed', description: 'Fires when a STATUS attribute transitions', config: { catalogId: 'optional', from: 'optional', to: 'optional' } },
          { type: 'reference.added', description: 'Fires when a reference is created', config: { catalogId: 'optional', referenceKind: 'optional' } },
          { type: 'schedule', description: 'Fires on a cron schedule', config: { cron: 'required cron expression', timezone: 'optional IANA timezone' } },
          { type: 'manual', description: 'Fires when triggered via API/MCP', config: { parameters: 'optional parameter definitions' } },
          { type: 'oql.match', description: 'Fires when OQL query returns results', config: { query: 'required OQL', triggerOn: 'new_results|count_change|any_results' } },
          { type: 'webhook.received', description: 'Fires on inbound webhook', config: { path: 'optional URL path', secret: 'optional HMAC secret' } },
        ],
      }),
    },

    {
      name: 'list_action_types',
      description: 'Show all available action types. Use this to understand what actions can be performed when creating automations.',
      inputSchema: z.object({}),
      handler: async () => ({
        actions: [
          { type: 'item.create', description: 'Create a new item', config: { catalogId: 'or catalogName', attributes: 'Record<name, value>' } },
          { type: 'item.update', description: 'Update item attributes', config: { itemId: 'or useTriggeredItem:true', attributes: 'Record<name, value>' } },
          { type: 'item.delete', description: 'Delete an item', config: { itemId: 'or useTriggeredItem:true' } },
          { type: 'attribute.set', description: 'Set one attribute', config: { attributeName: 'required', value: 'required', useTriggeredItem: 'true' } },
          { type: 'reference.add', description: 'Create item reference', config: { toItemId: 'required', referenceKind: 'optional', useTriggeredItem: 'true for fromItem' } },
          { type: 'reference.remove', description: 'Remove reference', config: { referenceId: 'required' } },
          { type: 'comment.add', description: 'Add comment to item', config: { body: 'required text', useTriggeredItem: 'true' } },
          { type: 'item.import', description: 'Bulk import items', config: { catalogId: 'or catalogName', rows: 'array of records' } },
          { type: 'catalog.create', description: 'Create new catalog', config: { name: 'required', workspaceId: 'defaults to automation workspace' } },
          { type: 'attribute.create', description: 'Add attribute to catalog', config: { catalogId: 'or catalogName', name: 'required', type: 'required' } },
          { type: 'workspace.member.add', description: 'Add member', config: { userId: 'required', role: 'required' } },
          { type: 'oql.execute', description: 'Run OQL query', config: { query: 'required', storeResultAs: 'optional variable name' } },
          { type: 'webhook.send', description: 'Send HTTP request', config: { url: 'required', method: 'optional', body: 'optional' } },
          { type: 'automation.trigger', description: 'Chain another automation', config: { automationId: 'required' } },
        ],
        templateVariables: [
          '{{trigger.item.id}}', '{{trigger.item.key}}', '{{trigger.item.attributes.FieldName}}',
          '{{trigger.previous.FieldName}}', '{{trigger.user.name}}', '{{trigger.timestamp}}',
          '{{env.NOW}}', '{{env.TODAY}}', '{{context.variables.name}}',
          '{{action[0].result.field}}', '{{oql:FROM Catalog SELECT COUNT(*)}}',
        ],
      }),
    },

    {
      name: 'list_condition_types',
      description: 'Show all available condition types and operators for filtering when automations execute.',
      inputSchema: z.object({}),
      handler: async () => ({
        types: [
          { type: 'attribute', description: 'Compare item attribute value', operators: ['equals', 'not_equals', 'contains', 'starts_with', 'ends_with', 'in', 'is_null', 'changed_to', 'changed_from', 'matches_regex'] },
          { type: 'oql', description: 'Passes if OQL query returns results', fields: { query: 'OQL query string', expectCount: 'optional exact count' } },
          { type: 'reference', description: 'Check item references', fields: { direction: 'outbound|inbound', exists: 'boolean' } },
          { type: 'template', description: 'Evaluate template expression as truthy', fields: { expression: 'template string' } },
        ],
        composition: { AND: 'All must pass', OR: 'Any must pass', NOT: 'Negates one condition' },
      }),
    },

    // ======================================================================
    // ONSTAQ Passthrough
    // ======================================================================
    {
      name: 'query_onstaq',
      description: 'Execute an OQL (Onstaq Query Language) query against an ONSTAQ workspace. Returns structured results.',
      inputSchema: z.object({
        query: z.string().describe('OQL query string (e.g., "FROM Test Case WHERE Priority = \'High\' SELECT @key, @label")'),
        workspaceId: z.string().uuid().describe('ONSTAQ workspace ID'),
      }),
      handler: async (input) => {
        return onstaqClient.executeOql(input.query, input.workspaceId);
      },
    },

    {
      name: 'get_workspace_schema',
      description: 'Get the full schema of an ONSTAQ workspace: all catalogs with their attributes. Essential for understanding the data model before creating automations.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('ONSTAQ workspace ID'),
      }),
      handler: async (input) => {
        const schema = await onstaqClient.getWorkspaceSchema(input.workspaceId);
        return {
          workspace: { id: schema.workspace.id, name: schema.workspace.name, key: schema.workspace.key },
          catalogs: schema.catalogs.map((c) => ({
            id: c.id,
            name: c.name,
            icon: c.icon,
            isAbstract: c.isAbstract,
            itemCount: c._count?.items || 0,
            attributes: c.allAttributes.map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
              isRequired: a.isRequired,
              cardinality: a.cardinality,
              config: a.config,
            })),
          })),
        };
      },
    },
  ];
}

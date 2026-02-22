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

ACTION TYPES: item.create, item.update, item.delete, item.clone, item.transition, item.lookup, attribute.set, reference.add, reference.remove, comment.add, item.import, catalog.create, attribute.create, workspace.member.add, oql.execute, webhook.send, automation.trigger, variable.set, log, refetch_data

COMPONENT CHAIN: Rules use a flat ordered list of components (actions, conditions, branches, if/else blocks) instead of separate conditions and actions.
BRANCH TYPES: related_items, created_items, lookup_items — iterate sub-components for each matched item.
IF/ELSE: Evaluate conditions, then execute then[] or else[] component paths.

Actions support {{template}} variables: {{trigger.item.id}}, {{trigger.item.key}}, {{trigger.item.attributes.AttributeName}}, {{trigger.previous.AttributeName}}, {{currentItem.id}}, {{variables.name}}, {{env.NOW}}, {{oql:QUERY}}`,
      inputSchema: z.object({
        name: z.string().describe('Human-readable name for this automation'),
        description: z.string().optional().describe('Description of what this automation does'),
        workspaceId: z.string().uuid().describe('ONSTAQ workspace ID this automation belongs to'),
        trigger: z.object({
          type: z.string().describe('Trigger type'),
        }).passthrough().describe('Trigger configuration'),
        components: z.array(z.object({
          id: z.string().describe('Unique component ID'),
          componentType: z.enum(['action', 'condition', 'branch', 'if_else']).describe('Component type'),
          action: z.object({
            type: z.string(),
            name: z.string().optional(),
            continueOnError: z.boolean().optional(),
            config: z.record(z.any()),
          }).optional(),
          condition: z.any().optional(),
          branch: z.any().optional(),
          ifElse: z.any().optional(),
        })).min(1).describe('Ordered component chain (actions, conditions, branches, if/else blocks)'),
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
            components: input.components as any,
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
      description: 'Update an existing automation. Only specified properties are changed.',
      inputSchema: z.object({
        automationId: z.string().uuid().describe('The automation ID to update'),
        name: z.string().optional(),
        description: z.string().optional(),
        enabled: z.boolean().optional(),
        trigger: z.any().optional(),
        components: z.array(z.any()).optional(),
      }),
      handler: async (input) => {
        const { automationId, ...data } = input;
        const updateData: any = {};
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.enabled !== undefined) updateData.enabled = data.enabled;
        if (data.trigger !== undefined) updateData.trigger = data.trigger;
        if (data.components !== undefined) updateData.components = data.components;

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
          '{{trigger.item.id}}', '{{trigger.item.key}}', '{{trigger.item.attributes.AttributeName}}',
          '{{trigger.previous.AttributeName}}', '{{trigger.user.name}}', '{{trigger.timestamp}}',
          '{{env.NOW}}', '{{env.TODAY}}', '{{context.variables.name}}',
          '{{action[0].result.property}}', '{{oql:FROM Catalog SELECT COUNT(*)}}',
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
          { type: 'oql', description: 'Passes if OQL query returns results', config: { query: 'OQL query string', expectCount: 'optional exact count' } },
          { type: 'reference', description: 'Check item references', config: { direction: 'outbound|inbound', exists: 'boolean' } },
          { type: 'template', description: 'Evaluate template expression as truthy', config: { expression: 'template string' } },
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

    // ======================================================================
    // Workspace Management
    // ======================================================================
    {
      name: 'list_workspaces',
      description: 'List all workspaces the authenticated user has access to.',
      inputSchema: z.object({}),
      handler: async () => {
        const workspaces = await onstaqClient.listWorkspaces();
        return { workspaces, count: workspaces.length };
      },
    },

    {
      name: 'get_workspace',
      description: 'Get details of a specific workspace including catalog count.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID'),
      }),
      handler: async (input) => {
        return onstaqClient.getWorkspace(input.workspaceId);
      },
    },

    {
      name: 'create_workspace',
      description: 'Create a new workspace.',
      inputSchema: z.object({
        name: z.string().describe('Workspace display name'),
        key: z.string().describe('Unique short key (e.g. "IT", "HR")'),
        description: z.string().optional().describe('Workspace description'),
      }),
      handler: async (input) => {
        return onstaqClient.createWorkspace(input);
      },
    },

    {
      name: 'update_workspace',
      description: 'Update workspace name, description, or settings.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID'),
        name: z.string().optional(),
        description: z.string().optional(),
        allowCrossWorkspaceRefs: z.boolean().optional().describe('Allow items to reference catalogs in other workspaces'),
      }),
      handler: async (input) => {
        const { workspaceId, ...data } = input;
        return onstaqClient.updateWorkspace(workspaceId, data);
      },
    },

    {
      name: 'delete_workspace',
      description: 'Permanently delete a workspace and all its catalogs, attributes, and items.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID to delete'),
      }),
      handler: async (input) => {
        await onstaqClient.deleteWorkspace(input.workspaceId);
        return { message: 'Workspace deleted', workspaceId: input.workspaceId };
      },
    },

    {
      name: 'list_workspace_members',
      description: 'List all members of a workspace with their roles.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID'),
      }),
      handler: async (input) => {
        const members = await onstaqClient.listMembers(input.workspaceId);
        return { members, count: members.length };
      },
    },

    {
      name: 'add_workspace_member',
      description: 'Add an existing user to a workspace with a specific role.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID'),
        userId: z.string().uuid().describe('User ID to add'),
        role: z.enum(['WORKSPACE_ADMIN', 'ITEM_EDITOR', 'ITEM_VIEWER']).describe('Workspace role'),
      }),
      handler: async (input) => {
        return onstaqClient.addMember(input.workspaceId, input.userId, input.role);
      },
    },

    {
      name: 'update_workspace_member_role',
      description: 'Change a workspace member\'s role.',
      inputSchema: z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['WORKSPACE_ADMIN', 'ITEM_EDITOR', 'ITEM_VIEWER']),
      }),
      handler: async (input) => {
        return onstaqClient.updateMemberRole(input.workspaceId, input.userId, input.role);
      },
    },

    {
      name: 'remove_workspace_member',
      description: 'Remove a member from a workspace.',
      inputSchema: z.object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
      handler: async (input) => {
        await onstaqClient.removeMember(input.workspaceId, input.userId);
        return { message: 'Member removed' };
      },
    },

    {
      name: 'invite_to_workspace',
      description: 'Invite a user by email to join a workspace. Creates an invitation link.',
      inputSchema: z.object({
        workspaceId: z.string().uuid(),
        email: z.string().email().describe('Email address to invite'),
        role: z.enum(['WORKSPACE_ADMIN', 'ITEM_EDITOR', 'ITEM_VIEWER']),
      }),
      handler: async (input) => {
        return onstaqClient.inviteToWorkspace(input.workspaceId, input.email, input.role);
      },
    },

    {
      name: 'export_workspace',
      description: 'Export a workspace configuration (catalogs, attributes, items) as JSON.',
      inputSchema: z.object({
        workspaceId: z.string().uuid(),
      }),
      handler: async (input) => {
        return onstaqClient.exportWorkspace(input.workspaceId);
      },
    },

    {
      name: 'clone_workspace',
      description: 'Clone a workspace structure (catalogs + attributes) into a new workspace.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Source workspace ID to clone'),
        name: z.string().describe('Name for the new workspace'),
        key: z.string().describe('Unique key for the new workspace'),
      }),
      handler: async (input) => {
        return onstaqClient.cloneWorkspace(input.workspaceId, input.name, input.key);
      },
    },

    {
      name: 'create_workspace_from_template',
      description: 'Create a new workspace from a predefined template. Use list_workspace_templates to see available templates.',
      inputSchema: z.object({
        templateId: z.string().describe('Template ID'),
        name: z.string().describe('Workspace name'),
        key: z.string().describe('Unique key'),
      }),
      handler: async (input) => {
        return onstaqClient.createFromTemplate(input.templateId, input.name, input.key);
      },
    },

    {
      name: 'list_workspace_templates',
      description: 'List available workspace templates (e.g. IT Asset Management, Project Management).',
      inputSchema: z.object({}),
      handler: async () => {
        return onstaqClient.listTemplates();
      },
    },

    // ======================================================================
    // Catalog Management
    // ======================================================================
    {
      name: 'list_catalogs',
      description: 'List all catalogs in a workspace. Catalogs are like item types/tables that define the schema for items.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().describe('Workspace ID'),
      }),
      handler: async (input) => {
        const catalogs = await onstaqClient.listCatalogs(input.workspaceId);
        return { catalogs, count: catalogs.length };
      },
    },

    {
      name: 'get_catalog',
      description: 'Get full catalog details including all attributes (own + inherited from parent), child types, and item count.',
      inputSchema: z.object({
        catalogId: z.string().uuid().describe('Catalog ID'),
      }),
      handler: async (input) => {
        return onstaqClient.getCatalog(input.catalogId);
      },
    },

    {
      name: 'create_catalog',
      description: 'Create a new catalog (item type) in a workspace. Optionally set a parent type for attribute inheritance.',
      inputSchema: z.object({
        workspaceId: z.string().uuid(),
        name: z.string().describe('Catalog name (e.g. "Server", "Application")'),
        description: z.string().optional(),
        icon: z.string().optional().describe('Lucide icon name (e.g. "server", "monitor")'),
        position: z.number().optional().describe('Display order'),
        isAbstract: z.boolean().optional().describe('If true, cannot create items directly — only used as parent type'),
        parentTypeId: z.string().uuid().optional().describe('Parent catalog ID for attribute inheritance'),
      }),
      handler: async (input) => {
        return onstaqClient.createCatalog(input);
      },
    },

    {
      name: 'update_catalog',
      description: 'Update catalog properties.',
      inputSchema: z.object({
        catalogId: z.string().uuid(),
        name: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        position: z.number().optional(),
        isAbstract: z.boolean().optional(),
        parentTypeId: z.string().uuid().optional(),
      }),
      handler: async (input) => {
        const { catalogId, ...data } = input;
        return onstaqClient.updateCatalog(catalogId, data);
      },
    },

    {
      name: 'delete_catalog',
      description: 'Delete a catalog and all its items. This is irreversible.',
      inputSchema: z.object({
        catalogId: z.string().uuid(),
      }),
      handler: async (input) => {
        await onstaqClient.deleteCatalog(input.catalogId);
        return { message: 'Catalog deleted', catalogId: input.catalogId };
      },
    },

    // ======================================================================
    // Attribute Management
    // ======================================================================
    {
      name: 'list_attributes',
      description: 'List all attributes defined on a catalog.',
      inputSchema: z.object({
        catalogId: z.string().uuid().describe('Catalog ID'),
      }),
      handler: async (input) => {
        const attributes = await onstaqClient.listAttributes(input.catalogId);
        return { attributes, count: attributes.length };
      },
    },

    {
      name: 'get_attribute',
      description: 'Get full details of a specific attribute.',
      inputSchema: z.object({
        attributeId: z.string().uuid(),
      }),
      handler: async (input) => {
        return onstaqClient.getAttribute(input.attributeId);
      },
    },

    {
      name: 'create_attribute',
      description: `Create a new attribute on a catalog.

TYPES: TEXT, TEXTAREA, INTEGER, FLOAT, BOOLEAN, DATE, DATETIME, EMAIL, URL, SELECT, MULTI_SELECT, ITEM_REFERENCE, USER, GROUP, ATTACHMENT, IP_ADDRESS, STATUS

For SELECT/MULTI_SELECT: pass config.options (string array)
For ITEM_REFERENCE: pass config.referenceCatalogId (target catalog UUID)
For STATUS: configure via catalog statusConfig`,
      inputSchema: z.object({
        catalogId: z.string().uuid(),
        name: z.string().describe('Attribute display name'),
        type: z.string().describe('Attribute type (TEXT, INTEGER, SELECT, ITEM_REFERENCE, etc.)'),
        description: z.string().optional(),
        position: z.number().optional(),
        isRequired: z.boolean().optional().default(false),
        isUnique: z.boolean().optional().default(false),
        isLabel: z.boolean().optional().default(false).describe('If true, value used as item display label'),
        isEditable: z.boolean().optional().default(true),
        defaultValue: z.any().optional(),
        cardinality: z.enum(['SINGLE', 'MULTI']).optional().default('SINGLE'),
        config: z.record(z.any()).optional().describe('Type-specific config: { options: [...] } for SELECT, { referenceCatalogId: "uuid" } for ITEM_REFERENCE'),
      }),
      handler: async (input) => {
        return onstaqClient.createAttribute(input as any);
      },
    },

    {
      name: 'update_attribute',
      description: 'Update attribute properties. Only specified values are changed.',
      inputSchema: z.object({
        attributeId: z.string().uuid(),
        name: z.string().optional(),
        description: z.string().optional(),
        position: z.number().optional(),
        isRequired: z.boolean().optional(),
        isUnique: z.boolean().optional(),
        isLabel: z.boolean().optional(),
        isEditable: z.boolean().optional(),
        defaultValue: z.any().optional(),
        cardinality: z.enum(['SINGLE', 'MULTI']).optional(),
        config: z.record(z.any()).optional(),
      }),
      handler: async (input) => {
        const { attributeId, ...data } = input;
        return onstaqClient.updateAttribute(attributeId, data as any);
      },
    },

    {
      name: 'delete_attribute',
      description: 'Delete an attribute and all its stored values.',
      inputSchema: z.object({
        attributeId: z.string().uuid(),
      }),
      handler: async (input) => {
        await onstaqClient.deleteAttribute(input.attributeId);
        return { message: 'Attribute deleted', attributeId: input.attributeId };
      },
    },

    // ======================================================================
    // Item Operations
    // ======================================================================
    {
      name: 'list_items',
      description: 'List items with pagination, filtering, sorting, and search. Use workspaceId OR catalogId to scope results.',
      inputSchema: z.object({
        workspaceId: z.string().uuid().optional().describe('Filter by workspace'),
        catalogId: z.string().uuid().optional().describe('Filter by catalog'),
        search: z.string().optional().describe('Full-text search across text attributes'),
        page: z.number().optional().default(1),
        limit: z.number().max(100).optional().default(25),
        sortBy: z.string().optional().describe('Attribute name or @key, @createdAt, @updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
        filters: z.array(z.object({
          attributeId: z.string().describe('Attribute ID to filter on'),
          operator: z.enum(['contains', 'equals']),
          value: z.any(),
        })).optional().describe('Attribute-level filters'),
      }),
      handler: async (input) => {
        return onstaqClient.listItems(input);
      },
    },

    {
      name: 'get_item',
      description: 'Get complete item details including all attribute values, resolved references, and metadata.',
      inputSchema: z.object({
        itemId: z.string().uuid().describe('Item ID'),
      }),
      handler: async (input) => {
        return onstaqClient.getItem(input.itemId);
      },
    },

    {
      name: 'create_item',
      description: 'Create a new item in a catalog. Pass attribute values as { "AttributeName": value } pairs.',
      inputSchema: z.object({
        catalogId: z.string().uuid().describe('Catalog to create the item in'),
        attributes: z.record(z.any()).optional().describe('Attribute values: { "Name": "value", "Priority": "High" }'),
        status: z.string().optional().describe('Initial status value (must match catalog statusConfig)'),
      }),
      handler: async (input) => {
        return onstaqClient.createItem(input.catalogId, input.attributes);
      },
    },

    {
      name: 'update_item',
      description: 'Update item attribute values. Only specified attributes are changed.',
      inputSchema: z.object({
        itemId: z.string().uuid().describe('Item ID to update'),
        attributes: z.record(z.any()).describe('Attribute values to update: { "Name": "new value" }'),
        status: z.string().optional().describe('New status value'),
      }),
      handler: async (input) => {
        return onstaqClient.updateItem(input.itemId, input.attributes);
      },
    },

    {
      name: 'delete_item',
      description: 'Permanently delete an item and all its attribute values, references, and history.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
      }),
      handler: async (input) => {
        await onstaqClient.deleteItem(input.itemId);
        return { message: 'Item deleted', itemId: input.itemId };
      },
    },

    {
      name: 'import_items',
      description: 'Bulk import items into a catalog. Each row is a { "AttributeName": value } record. Supports create + update (matched by key column).',
      inputSchema: z.object({
        catalogId: z.string().uuid(),
        rows: z.array(z.record(z.any())).describe('Array of item records'),
        keyColumn: z.string().optional().describe('Column to match existing items for upsert'),
      }),
      handler: async (input) => {
        return onstaqClient.importItems(input.catalogId, input.rows, input.keyColumn);
      },
    },

    // ======================================================================
    // Item References
    // ======================================================================
    {
      name: 'get_item_references',
      description: 'Get all outbound and inbound explicit references for an item.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
      }),
      handler: async (input) => {
        return onstaqClient.getReferences(input.itemId);
      },
    },

    {
      name: 'create_item_reference',
      description: 'Create an explicit reference from one item to another.',
      inputSchema: z.object({
        fromItemId: z.string().uuid().describe('Source item ID'),
        toItemId: z.string().uuid().describe('Target item ID'),
        referenceKind: z.enum(['DEPENDENCY', 'INSTALLED', 'LINK', 'OWNERSHIP', 'LOCATED_IN', 'CUSTOM']).optional().default('LINK'),
        label: z.string().optional().describe('Optional description of this reference'),
      }),
      handler: async (input) => {
        return onstaqClient.createReference(input.fromItemId, input.toItemId, input.referenceKind, input.label);
      },
    },

    {
      name: 'delete_item_reference',
      description: 'Delete an explicit reference between items.',
      inputSchema: z.object({
        itemId: z.string().uuid().describe('The item that owns the reference'),
        referenceId: z.string().uuid().describe('Reference ID to delete'),
      }),
      handler: async (input) => {
        await onstaqClient.deleteReference(input.itemId, input.referenceId);
        return { message: 'Reference deleted' };
      },
    },

    {
      name: 'get_back_references',
      description: 'Get all items that reference a given item, grouped by source catalog.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
      }),
      handler: async (input) => {
        return onstaqClient.getBackReferences(input.itemId);
      },
    },

    // ======================================================================
    // Item Comments
    // ======================================================================
    {
      name: 'list_item_comments',
      description: 'Get all comments on an item.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
      }),
      handler: async (input) => {
        const comments = await onstaqClient.getComments(input.itemId);
        return { comments, count: comments.length };
      },
    },

    {
      name: 'add_item_comment',
      description: 'Add a comment to an item.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
        body: z.string().describe('Comment text'),
      }),
      handler: async (input) => {
        return onstaqClient.addComment(input.itemId, input.body);
      },
    },

    // ======================================================================
    // Item History
    // ======================================================================
    {
      name: 'get_item_history',
      description: 'Get the audit log / change history for an item.',
      inputSchema: z.object({
        itemId: z.string().uuid(),
      }),
      handler: async (input) => {
        const history = await onstaqClient.getHistory(input.itemId);
        return { history, count: history.length };
      },
    },
  ];
}

// =============================================================================
// Request Validation Schemas (Zod)
// =============================================================================

import { z } from 'zod';

// --- Trigger Schemas ---

const itemTriggerBase = z.object({
  catalogId: z.string().uuid().optional(),
  catalogName: z.string().optional(),
});

const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('item.created'), ...itemTriggerBase.shape }),
  z.object({
    type: z.literal('item.updated'),
    ...itemTriggerBase.shape,
    attributes: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('item.deleted'), ...itemTriggerBase.shape }),
  z.object({
    type: z.literal('attribute.changed'),
    ...itemTriggerBase.shape,
    attributeName: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  z.object({
    type: z.literal('status.changed'),
    ...itemTriggerBase.shape,
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  z.object({
    type: z.literal('reference.added'),
    ...itemTriggerBase.shape,
    referenceKind: z.enum(['DEPENDENCY', 'INSTALLED', 'LINK', 'OWNERSHIP', 'LOCATED_IN', 'CUSTOM']).optional(),
  }),
  z.object({
    type: z.literal('schedule'),
    cron: z.string().min(1),
    timezone: z.string().optional(),
  }),
  z.object({
    type: z.literal('manual'),
    catalogId: z.string().uuid().optional(),
    catalogName: z.string().optional(),
    parameters: z.array(z.object({
      name: z.string(),
      type: z.enum(['string', 'number', 'boolean']),
      required: z.boolean().optional(),
      defaultValue: z.any().optional(),
    })).optional(),
  }),
  z.object({
    type: z.literal('oql.match'),
    query: z.string().min(1),
    interval: z.number().positive().optional(),
    triggerOn: z.enum(['new_results', 'count_change', 'any_results']),
  }),
  z.object({
    type: z.literal('webhook.received'),
    path: z.string().optional(),
    secret: z.string().optional(),
    filter: z.record(z.any()).optional(),
  }),
]);

// --- Condition Schemas ---

const singleConditionSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('attribute'),
      field: z.string(),
      operator: z.enum([
        'equals', 'not_equals', 'contains', 'not_contains',
        'starts_with', 'ends_with', 'greater_than', 'less_than',
        'greater_than_or_equal', 'less_than_or_equal',
        'in', 'not_in', 'is_null', 'is_not_null',
        'changed_to', 'changed_from', 'matches_regex',
      ]),
      value: z.any().optional(),
      from: z.any().optional(),
      to: z.any().optional(),
    }),
    z.object({
      type: z.literal('oql'),
      query: z.string().min(1),
      expectCount: z.number().optional(),
    }),
    z.object({
      type: z.literal('reference'),
      direction: z.enum(['outbound', 'inbound']),
      catalogName: z.string().optional(),
      referenceKind: z.string().optional(),
      exists: z.boolean(),
    }),
    z.object({
      type: z.literal('template'),
      expression: z.string().min(1),
    }),
  ])
);

const conditionGroupSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    operator: z.enum(['AND', 'OR', 'NOT']),
    conditions: z.array(z.union([singleConditionSchema, conditionGroupSchema])).min(1),
  })
);

const conditionSchema = z.union([singleConditionSchema, conditionGroupSchema]).nullable().optional();

// --- Action Schemas ---

const actionSchema = z.object({
  type: z.enum([
    'item.create', 'item.update', 'item.delete',
    'attribute.set', 'reference.add', 'reference.remove',
    'comment.add', 'item.import',
    'catalog.create', 'attribute.create',
    'workspace.member.add', 'oql.execute',
    'webhook.send', 'automation.trigger',
  ]),
  name: z.string().optional(),
  continueOnError: z.boolean().optional(),
  config: z.record(z.any()),
});

// --- Automation CRUD Schemas ---

export const createAutomationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  workspaceId: z.string().uuid(),
  workspaceKey: z.string().optional(),
  enabled: z.boolean().optional().default(true),
  trigger: triggerSchema,
  conditions: conditionSchema,
  actions: z.array(actionSchema).min(1),
  executionOrder: z.number().int().optional().default(0),
});

export const updateAutomationSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  conditions: conditionSchema,
  actions: z.array(actionSchema).min(1).optional(),
  executionOrder: z.number().int().optional(),
});

export const executeAutomationSchema = z.object({
  parameters: z.record(z.any()).optional(),
});

export const testAutomationSchema = z.object({
  mockTriggerData: z.record(z.any()).optional(),
});

export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;

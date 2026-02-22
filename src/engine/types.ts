// =============================================================================
// Automation Engine Type Definitions
// Triggers, Conditions, Actions — the core DSL
// =============================================================================

import { Item, ReferenceKind } from '../onstaq/types';

// --- Trigger Types ---

export type TriggerType =
  | 'item.created'
  | 'item.updated'
  | 'item.deleted'
  | 'attribute.changed'
  | 'status.changed'
  | 'reference.added'
  | 'schedule'
  | 'manual'
  | 'oql.match'
  | 'webhook.received';

export interface BaseTriggerConfig {
  type: TriggerType;
}

export interface ItemCreatedTrigger extends BaseTriggerConfig {
  type: 'item.created';
  catalogId?: string;       // Filter by catalog (optional)
  catalogName?: string;     // Alternative: match by name
}

export interface ItemUpdatedTrigger extends BaseTriggerConfig {
  type: 'item.updated';
  catalogId?: string;
  catalogName?: string;
  attributes?: string[];    // Only trigger for specific attribute changes
}

export interface ItemDeletedTrigger extends BaseTriggerConfig {
  type: 'item.deleted';
  catalogId?: string;
  catalogName?: string;
}

export interface AttributeChangedTrigger extends BaseTriggerConfig {
  type: 'attribute.changed';
  catalogId?: string;
  catalogName?: string;
  attributeName: string;    // Watch a specific attribute
  from?: string;            // Optional: only trigger on specific old value
  to?: string;              // Optional: only trigger on specific new value
}

export interface StatusChangedTrigger extends BaseTriggerConfig {
  type: 'status.changed';
  catalogId?: string;
  catalogName?: string;
  from?: string;
  to?: string;
}

export interface ReferenceAddedTrigger extends BaseTriggerConfig {
  type: 'reference.added';
  catalogId?: string;
  catalogName?: string;
  referenceKind?: ReferenceKind;
}

export interface ScheduleTrigger extends BaseTriggerConfig {
  type: 'schedule';
  cron: string;             // Cron expression (e.g., "0 9 * * MON-FRI")
  timezone?: string;        // IANA timezone (default: UTC)
}

export interface ManualTrigger extends BaseTriggerConfig {
  type: 'manual';
  parameters?: {            // Optional parameters that can be passed when manually triggering
    name: string;
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
    defaultValue?: any;
  }[];
}

export interface OqlMatchTrigger extends BaseTriggerConfig {
  type: 'oql.match';
  query: string;            // OQL query to execute
  interval?: number;        // Check interval in seconds (default: 60)
  triggerOn: 'new_results' | 'count_change' | 'any_results';
}

export interface WebhookReceivedTrigger extends BaseTriggerConfig {
  type: 'webhook.received';
  path?: string;            // Custom webhook path suffix
  secret?: string;          // HMAC validation secret
  filter?: Record<string, any>;  // Filter on webhook body fields
}

export type TriggerConfig =
  | ItemCreatedTrigger
  | ItemUpdatedTrigger
  | ItemDeletedTrigger
  | AttributeChangedTrigger
  | StatusChangedTrigger
  | ReferenceAddedTrigger
  | ScheduleTrigger
  | ManualTrigger
  | OqlMatchTrigger
  | WebhookReceivedTrigger;

// --- Trigger Event (runtime data when a trigger fires) ---

export interface TriggerEvent {
  type: TriggerType;
  automationId: string;
  timestamp: string;
  item?: Item;
  previousValues?: Record<string, any>;
  oqlResults?: Record<string, any>[];
  webhookPayload?: Record<string, any>;
  manualParameters?: Record<string, any>;
  scheduleTime?: string;
}

// --- Condition Types ---

export type ConditionOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'greater_than' | 'less_than'
  | 'greater_than_or_equal' | 'less_than_or_equal'
  | 'in' | 'not_in'
  | 'is_null' | 'is_not_null'
  | 'changed_to' | 'changed_from'
  | 'matches_regex';

export interface AttributeCondition {
  type: 'attribute';
  field: string;            // Attribute name
  operator: ConditionOperator;
  value?: any;
  from?: any;               // For changed_from/changed_to
  to?: any;
}

export interface OqlCondition {
  type: 'oql';
  query: string;            // OQL query — condition passes if results > 0
  expectCount?: number;     // Optional: pass only if result count matches
}

export interface ReferenceCondition {
  type: 'reference';
  direction: 'outbound' | 'inbound';
  catalogName?: string;     // Optional: filter by referenced catalog
  referenceKind?: ReferenceKind;
  exists: boolean;          // true = must have references, false = must not
}

export interface TemplateCondition {
  type: 'template';
  expression: string;       // Template expression that evaluates to truthy/falsy
}

export type SingleCondition =
  | AttributeCondition
  | OqlCondition
  | ReferenceCondition
  | TemplateCondition;

export interface ConditionGroup {
  operator: 'AND' | 'OR' | 'NOT';
  conditions: (SingleCondition | ConditionGroup)[];
}

export type ConditionConfig = SingleCondition | ConditionGroup;

// --- Action Types ---

export type ActionType =
  | 'item.create'
  | 'item.update'
  | 'item.delete'
  | 'attribute.set'
  | 'reference.add'
  | 'reference.remove'
  | 'comment.add'
  | 'item.import'
  | 'catalog.create'
  | 'attribute.create'
  | 'workspace.member.add'
  | 'oql.execute'
  | 'webhook.send'
  | 'automation.trigger';

export interface BaseActionConfig {
  type: ActionType;
  name?: string;            // Human-readable name for this step
  continueOnError?: boolean; // Default: false — stop chain on error
}

export interface ItemCreateAction extends BaseActionConfig {
  type: 'item.create';
  config: {
    catalogId?: string;
    catalogName?: string;   // Resolved at runtime to catalogId
    attributes: Record<string, string>; // Values support {{template}} syntax
  };
}

export interface ItemUpdateAction extends BaseActionConfig {
  type: 'item.update';
  config: {
    itemId?: string;        // Specific item ID or template
    itemKey?: string;       // Alternative: match by key
    useTriggeredItem?: boolean; // Default: true — update the item that triggered
    attributes: Record<string, string>;
  };
}

export interface ItemDeleteAction extends BaseActionConfig {
  type: 'item.delete';
  config: {
    itemId?: string;
    itemKey?: string;
    useTriggeredItem?: boolean;
  };
}

export interface AttributeSetAction extends BaseActionConfig {
  type: 'attribute.set';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    attributeName: string;
    value: string;          // Supports {{template}}
  };
}

export interface ReferenceAddAction extends BaseActionConfig {
  type: 'reference.add';
  config: {
    fromItemId?: string;
    useTriggeredItem?: boolean; // Use triggered item as "from"
    toItemId: string;
    referenceKind?: ReferenceKind;
    label?: string;
  };
}

export interface ReferenceRemoveAction extends BaseActionConfig {
  type: 'reference.remove';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    referenceId: string;
  };
}

export interface CommentAddAction extends BaseActionConfig {
  type: 'comment.add';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    body: string;           // Supports {{template}}
  };
}

export interface ItemImportAction extends BaseActionConfig {
  type: 'item.import';
  config: {
    catalogId?: string;
    catalogName?: string;
    keyColumn?: string;
    rows: Record<string, string>[]; // Each value supports {{template}}
  };
}

export interface CatalogCreateAction extends BaseActionConfig {
  type: 'catalog.create';
  config: {
    workspaceId?: string;   // Defaults to automation's workspace
    name: string;
    description?: string;
    icon?: string;
    isAbstract?: boolean;
    parentTypeId?: string;
  };
}

export interface AttributeCreateAction extends BaseActionConfig {
  type: 'attribute.create';
  config: {
    catalogId?: string;
    catalogName?: string;
    name: string;
    type: string;
    isRequired?: boolean;
    config?: Record<string, any>;
  };
}

export interface WorkspaceMemberAddAction extends BaseActionConfig {
  type: 'workspace.member.add';
  config: {
    workspaceId?: string;
    userId: string;
    role: string;
  };
}

export interface OqlExecuteAction extends BaseActionConfig {
  type: 'oql.execute';
  config: {
    query: string;          // Supports {{template}}
    workspaceId?: string;
    storeResultAs?: string; // Store result in execution context for later actions
  };
}

export interface WebhookSendAction extends BaseActionConfig {
  type: 'webhook.send';
  config: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    body?: Record<string, any>; // Deep template resolution
  };
}

export interface AutomationTriggerAction extends BaseActionConfig {
  type: 'automation.trigger';
  config: {
    automationId: string;
    parameters?: Record<string, string>;
  };
}

export type ActionConfig =
  | ItemCreateAction
  | ItemUpdateAction
  | ItemDeleteAction
  | AttributeSetAction
  | ReferenceAddAction
  | ReferenceRemoveAction
  | CommentAddAction
  | ItemImportAction
  | CatalogCreateAction
  | AttributeCreateAction
  | WorkspaceMemberAddAction
  | OqlExecuteAction
  | WebhookSendAction
  | AutomationTriggerAction;

// --- Execution Context (passed through trigger → condition → action chain) ---

export interface ExecutionContext {
  automationId: string;
  automationName: string;
  workspaceId: string;
  trigger: TriggerEvent;
  conditionResult?: {
    passed: boolean;
    details: Record<string, any>;
  };
  actionResults: {
    actionIndex: number;
    actionType: ActionType;
    actionName?: string;
    status: 'success' | 'failed' | 'skipped';
    result?: any;
    error?: string;
    durationMs: number;
  }[];
  variables: Record<string, any>;  // Accumulates results from OQL actions, etc.
  startedAt: Date;
}

// --- Automation Rule (full definition) ---

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  workspaceId: string;
  workspaceKey?: string;
  enabled: boolean;
  trigger: TriggerConfig;
  conditions?: ConditionConfig;
  actions: ActionConfig[];
  executionOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

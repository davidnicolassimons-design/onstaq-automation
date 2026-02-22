// =============================================================================
// Automation Engine Type Definitions
// Component-chain architecture: Trigger → Components[] (actions, conditions, branches, if/else)
// =============================================================================

import { Item, ReferenceKind } from '../onstaq/types';
export type { Item } from '../onstaq/types';

// --- Trigger Types ---

export type TriggerType =
  | 'item.created'
  | 'item.updated'
  | 'item.deleted'
  | 'attribute.changed'
  | 'status.changed'
  | 'reference.added'
  | 'item.linked'
  | 'item.unlinked'
  | 'item.commented'
  | 'schedule'
  | 'manual'
  | 'oql.match'
  | 'webhook.received';

export interface BaseTriggerConfig {
  type: TriggerType;
}

export interface ItemCreatedTrigger extends BaseTriggerConfig {
  type: 'item.created';
  catalogId?: string;
  catalogName?: string;
}

export interface ItemUpdatedTrigger extends BaseTriggerConfig {
  type: 'item.updated';
  catalogId?: string;
  catalogName?: string;
  attributes?: string[];
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
  attributeName: string;
  from?: string;
  to?: string;
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

export interface ItemLinkedTrigger extends BaseTriggerConfig {
  type: 'item.linked';
  catalogId?: string;
  catalogName?: string;
  referenceKind?: ReferenceKind;
}

export interface ItemUnlinkedTrigger extends BaseTriggerConfig {
  type: 'item.unlinked';
  catalogId?: string;
  catalogName?: string;
  referenceKind?: ReferenceKind;
}

export interface ItemCommentedTrigger extends BaseTriggerConfig {
  type: 'item.commented';
  catalogId?: string;
  catalogName?: string;
}

export interface ScheduleTrigger extends BaseTriggerConfig {
  type: 'schedule';
  cron: string;
  timezone?: string;
}

export interface ManualTrigger extends BaseTriggerConfig {
  type: 'manual';
  catalogId?: string;
  catalogName?: string;
  parameters?: {
    name: string;
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
    defaultValue?: any;
  }[];
}

export interface OqlMatchTrigger extends BaseTriggerConfig {
  type: 'oql.match';
  query: string;
  interval?: number;
  triggerOn: 'new_results' | 'count_change' | 'any_results';
}

export interface WebhookReceivedTrigger extends BaseTriggerConfig {
  type: 'webhook.received';
  path?: string;
  secret?: string;
  filter?: Record<string, any>;
}

export type TriggerConfig =
  | ItemCreatedTrigger
  | ItemUpdatedTrigger
  | ItemDeletedTrigger
  | AttributeChangedTrigger
  | StatusChangedTrigger
  | ReferenceAddedTrigger
  | ItemLinkedTrigger
  | ItemUnlinkedTrigger
  | ItemCommentedTrigger
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
  attribute: string;
  operator: ConditionOperator;
  value?: any;
  from?: any;
  to?: any;
}

export interface OqlCondition {
  type: 'oql';
  query: string;
  expectCount?: number;
}

export interface ReferenceCondition {
  type: 'reference';
  direction: 'outbound' | 'inbound';
  catalogName?: string;
  referenceKind?: ReferenceKind;
  exists: boolean;
}

export interface TemplateCondition {
  type: 'template';
  expression: string;
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
  | 'item.clone'
  | 'item.transition'
  | 'item.lookup'
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
  | 'automation.trigger'
  | 'variable.set'
  | 'log'
  | 'refetch_data';

export interface BaseActionConfig {
  type: ActionType;
  name?: string;
  continueOnError?: boolean;
}

export interface ItemCreateAction extends BaseActionConfig {
  type: 'item.create';
  config: {
    catalogId?: string;
    catalogName?: string;
    attributes: Record<string, string>;
  };
}

export interface ItemUpdateAction extends BaseActionConfig {
  type: 'item.update';
  config: {
    itemId?: string;
    itemKey?: string;
    useTriggeredItem?: boolean;
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

export interface ItemCloneAction extends BaseActionConfig {
  type: 'item.clone';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    targetCatalogId?: string;
    targetCatalogName?: string;
    attributeOverrides?: Record<string, string>;
  };
}

export interface ItemTransitionAction extends BaseActionConfig {
  type: 'item.transition';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    status: string;
  };
}

export interface ItemLookupAction extends BaseActionConfig {
  type: 'item.lookup';
  config: {
    query: string;
    workspaceId?: string;
    storeResultAs: string;
  };
}

export interface AttributeSetAction extends BaseActionConfig {
  type: 'attribute.set';
  config: {
    itemId?: string;
    useTriggeredItem?: boolean;
    attributeName: string;
    value: string;
  };
}

export interface ReferenceAddAction extends BaseActionConfig {
  type: 'reference.add';
  config: {
    fromItemId?: string;
    useTriggeredItem?: boolean;
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
    body: string;
  };
}

export interface ItemImportAction extends BaseActionConfig {
  type: 'item.import';
  config: {
    catalogId?: string;
    catalogName?: string;
    keyColumn?: string;
    rows: Record<string, string>[];
  };
}

export interface CatalogCreateAction extends BaseActionConfig {
  type: 'catalog.create';
  config: {
    workspaceId?: string;
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
    query: string;
    workspaceId?: string;
    storeResultAs?: string;
  };
}

export interface WebhookSendAction extends BaseActionConfig {
  type: 'webhook.send';
  config: {
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    body?: Record<string, any>;
  };
}

export interface AutomationTriggerAction extends BaseActionConfig {
  type: 'automation.trigger';
  config: {
    automationId: string;
    parameters?: Record<string, string>;
  };
}

export interface VariableSetAction extends BaseActionConfig {
  type: 'variable.set';
  config: {
    name: string;
    value: string;
  };
}

export interface LogAction extends BaseActionConfig {
  type: 'log';
  config: {
    message: string;
  };
}

export interface RefetchDataAction extends BaseActionConfig {
  type: 'refetch_data';
  config: Record<string, never>;
}

export type ActionConfig =
  | ItemCreateAction
  | ItemUpdateAction
  | ItemDeleteAction
  | ItemCloneAction
  | ItemTransitionAction
  | ItemLookupAction
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
  | AutomationTriggerAction
  | VariableSetAction
  | LogAction
  | RefetchDataAction;

// --- Component Chain Architecture ---

export type ComponentType = 'action' | 'condition' | 'branch' | 'if_else';

export type BranchType = 'related_items' | 'created_items' | 'lookup_items';

export interface BranchConfig {
  type: BranchType;
  // related_items config:
  direction?: 'outbound' | 'inbound';
  referenceKind?: ReferenceKind;
  catalogId?: string;
  catalogName?: string;
  // lookup_items config:
  oqlQuery?: string;
  // Sub-components to execute for each item in the branch:
  components: RuleComponent[];
}

export interface IfElseConfig {
  conditions: ConditionConfig;
  then: RuleComponent[];
  else?: RuleComponent[];
}

export interface RuleComponent {
  id: string;
  componentType: ComponentType;
  action?: ActionConfig;
  condition?: ConditionConfig;
  branch?: BranchConfig;
  ifElse?: IfElseConfig;
}

// --- Execution Context ---

export interface ComponentResult {
  componentId: string;
  componentType: ComponentType;
  actionType?: ActionType;
  status: 'success' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  durationMs: number;
  children?: ComponentResult[];
}

export interface ExecutionContext {
  automationId: string;
  automationName: string;
  workspaceId: string;
  trigger: TriggerEvent;
  componentResults: ComponentResult[];
  variables: Record<string, any>;
  createdItems: Item[];
  currentItem?: Item;
  startedAt: Date;
}

// --- Automation Rule ---

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  workspaceId: string;
  workspaceKey?: string;
  enabled: boolean;
  trigger: TriggerConfig;
  components: RuleComponent[];
  executionOrder: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

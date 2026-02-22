// =============================================================================
// Action Runner
// Executes individual actions against the ONSTAQ API with template resolution
// =============================================================================

import {
  ActionConfig, ExecutionContext, ActionType,
  ItemCreateAction, ItemUpdateAction, ItemDeleteAction,
  ItemCloneAction, ItemTransitionAction, ItemLookupAction,
  AttributeSetAction, ReferenceAddAction, ReferenceRemoveAction,
  CommentAddAction, ItemImportAction, CatalogCreateAction,
  AttributeCreateAction, WorkspaceMemberAddAction,
  OqlExecuteAction, WebhookSendAction, AutomationTriggerAction,
  VariableSetAction, LogAction, RefetchDataAction
} from './types';
import { OnstaqClient } from '../onstaq/client';
import { TemplateResolver } from './template-resolver';
import { logger } from '../utils/logger';
import axios from 'axios';

interface ActionResult {
  actionType: ActionType;
  actionName?: string;
  status: 'success' | 'failed' | 'skipped';
  result?: any;
  error?: string;
  durationMs: number;
}

export class ActionRunner {
  private onstaqClient: OnstaqClient;
  private templateResolver: TemplateResolver;
  private triggerAutomation?: (automationId: string, params?: Record<string, any>) => Promise<void>;

  constructor(
    onstaqClient: OnstaqClient,
    templateResolver: TemplateResolver,
    triggerAutomation?: (automationId: string, params?: Record<string, any>) => Promise<void>
  ) {
    this.onstaqClient = onstaqClient;
    this.templateResolver = templateResolver;
    this.triggerAutomation = triggerAutomation;
  }

  /**
   * Execute a single action and return the result.
   */
  async executeOne(action: ActionConfig, ctx: ExecutionContext): Promise<ActionResult> {
    const start = Date.now();

    try {
      const result = await this.executeAction(action, ctx);
      const actionResult: ActionResult = {
        actionType: action.type,
        actionName: action.name,
        status: 'success',
        result,
        durationMs: Date.now() - start,
      };

      logger.info(`Action ${action.type}${action.name ? ` (${action.name})` : ''} succeeded in ${actionResult.durationMs}ms`);
      return actionResult;
    } catch (err: any) {
      const actionResult: ActionResult = {
        actionType: action.type,
        actionName: action.name,
        status: 'failed',
        error: err.message || String(err),
        durationMs: Date.now() - start,
      };

      logger.error(`Action ${action.type} failed: ${err.message}`);
      return actionResult;
    }
  }

  /**
   * Execute a single action.
   */
  private async executeAction(action: ActionConfig, ctx: ExecutionContext): Promise<any> {
    switch (action.type) {
      case 'item.create':
        return this.executeItemCreate(action as ItemCreateAction, ctx);
      case 'item.update':
        return this.executeItemUpdate(action as ItemUpdateAction, ctx);
      case 'item.delete':
        return this.executeItemDelete(action as ItemDeleteAction, ctx);
      case 'item.clone':
        return this.executeItemClone(action as ItemCloneAction, ctx);
      case 'item.transition':
        return this.executeItemTransition(action as ItemTransitionAction, ctx);
      case 'item.lookup':
        return this.executeItemLookup(action as ItemLookupAction, ctx);
      case 'attribute.set':
        return this.executeAttributeSet(action as AttributeSetAction, ctx);
      case 'reference.add':
        return this.executeReferenceAdd(action as ReferenceAddAction, ctx);
      case 'reference.remove':
        return this.executeReferenceRemove(action as ReferenceRemoveAction, ctx);
      case 'comment.add':
        return this.executeCommentAdd(action as CommentAddAction, ctx);
      case 'item.import':
        return this.executeItemImport(action as ItemImportAction, ctx);
      case 'catalog.create':
        return this.executeCatalogCreate(action as CatalogCreateAction, ctx);
      case 'attribute.create':
        return this.executeAttributeCreate(action as AttributeCreateAction, ctx);
      case 'workspace.member.add':
        return this.executeWorkspaceMemberAdd(action as WorkspaceMemberAddAction, ctx);
      case 'oql.execute':
        return this.executeOql(action as OqlExecuteAction, ctx);
      case 'webhook.send':
        return this.executeWebhookSend(action as WebhookSendAction, ctx);
      case 'automation.trigger':
        return this.executeAutomationTrigger(action as AutomationTriggerAction, ctx);
      case 'variable.set':
        return this.executeVariableSet(action as VariableSetAction, ctx);
      case 'log':
        return this.executeLog(action as LogAction, ctx);
      case 'refetch_data':
        return this.executeRefetchData(action as RefetchDataAction, ctx);
      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  }

  // ---- Action Implementations ----

  private async executeItemCreate(action: ItemCreateAction, ctx: ExecutionContext): Promise<any> {
    const { catalogId, catalogName, attributes } = action.config;

    let resolvedCatalogId = catalogId;
    if (!resolvedCatalogId && catalogName) {
      resolvedCatalogId = await this.resolveCatalogId(catalogName, ctx.workspaceId);
    }
    if (!resolvedCatalogId) {
      throw new Error('item.create requires catalogId or catalogName');
    }

    const resolvedAttributes = await this.templateResolver.resolveValue(attributes, ctx);
    const item = await this.onstaqClient.createItem(resolvedCatalogId, resolvedAttributes);

    // Track created items for created_items branch
    ctx.createdItems.push(item);

    logger.info(`Created item ${item.key} in catalog ${resolvedCatalogId}`);
    return { itemId: item.id, itemKey: item.key };
  }

  private async executeItemUpdate(action: ItemUpdateAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, itemKey, useTriggeredItem = true, attributes } = action.config;

    const targetId = await this.resolveItemId(itemId, itemKey, useTriggeredItem, ctx);
    const resolvedAttributes = await this.templateResolver.resolveValue(attributes, ctx);
    const item = await this.onstaqClient.updateItem(targetId, resolvedAttributes);

    logger.info(`Updated item ${item.key}`);
    return { itemId: item.id, itemKey: item.key };
  }

  private async executeItemDelete(action: ItemDeleteAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, itemKey, useTriggeredItem = true } = action.config;

    const targetId = await this.resolveItemId(itemId, itemKey, useTriggeredItem, ctx);
    await this.onstaqClient.deleteItem(targetId);

    logger.info(`Deleted item ${targetId}`);
    return { deletedItemId: targetId };
  }

  private async executeItemClone(action: ItemCloneAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, useTriggeredItem = true, targetCatalogId, targetCatalogName, attributeOverrides } = action.config;

    const sourceId = await this.resolveItemId(itemId, undefined, useTriggeredItem, ctx);
    const sourceItem = await this.onstaqClient.getItem(sourceId);

    // Resolve target catalog
    let catalogId = targetCatalogId || sourceItem.catalogId;
    if (!catalogId && targetCatalogName) {
      catalogId = await this.resolveCatalogId(targetCatalogName, ctx.workspaceId);
    }

    // Merge source attributes with overrides
    const attributes = { ...(sourceItem.attributeValues || {}) };
    if (attributeOverrides) {
      const resolvedOverrides = await this.templateResolver.resolveValue(attributeOverrides, ctx);
      Object.assign(attributes, resolvedOverrides);
    }

    const clonedItem = await this.onstaqClient.createItem(catalogId, attributes);
    ctx.createdItems.push(clonedItem);

    logger.info(`Cloned item ${sourceItem.key} → ${clonedItem.key}`);
    return { itemId: clonedItem.id, itemKey: clonedItem.key, sourceItemId: sourceId };
  }

  private async executeItemTransition(action: ItemTransitionAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, useTriggeredItem = true, status } = action.config;

    const targetId = await this.resolveItemId(itemId, undefined, useTriggeredItem, ctx);
    const resolvedStatus = await this.templateResolver.resolveString(status, ctx);

    const item = await this.onstaqClient.updateItem(targetId, { STATUS: resolvedStatus });
    logger.info(`Transitioned item ${item.key} to status "${resolvedStatus}"`);
    return { itemId: item.id, itemKey: item.key, status: resolvedStatus };
  }

  private async executeItemLookup(action: ItemLookupAction, ctx: ExecutionContext): Promise<any> {
    const { query, workspaceId, storeResultAs } = action.config;

    const resolvedQuery = await this.templateResolver.resolveString(query, ctx);
    const result = await this.onstaqClient.executeOql(resolvedQuery, workspaceId || ctx.workspaceId);

    ctx.variables[storeResultAs] = result;

    logger.info(`Item lookup: ${result.totalCount} results stored as "${storeResultAs}"`);
    return { totalCount: result.totalCount, storeResultAs };
  }

  private async executeAttributeSet(action: AttributeSetAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, useTriggeredItem = true, attributeName, value } = action.config;

    const targetId = await this.resolveItemId(itemId, undefined, useTriggeredItem, ctx);
    const resolvedValue = await this.templateResolver.resolveString(value, ctx);

    const item = await this.onstaqClient.updateItem(targetId, { [attributeName]: resolvedValue });
    logger.info(`Set ${attributeName}=${resolvedValue} on item ${item.key}`);
    return { itemId: item.id, itemKey: item.key, attributeName, value: resolvedValue };
  }

  private async executeReferenceAdd(action: ReferenceAddAction, ctx: ExecutionContext): Promise<any> {
    const { fromItemId, useTriggeredItem = true, toItemId, referenceKind, label } = action.config;

    const resolvedFromId = await this.resolveItemId(fromItemId, undefined, useTriggeredItem, ctx);
    const resolvedToId = await this.templateResolver.resolveString(toItemId, ctx);
    const resolvedLabel = label ? await this.templateResolver.resolveString(label, ctx) : undefined;

    const ref = await this.onstaqClient.createReference(resolvedFromId, resolvedToId, referenceKind, resolvedLabel);
    logger.info(`Added ${referenceKind || 'LINK'} reference from ${resolvedFromId} to ${resolvedToId}`);
    return { referenceId: ref.id };
  }

  private async executeReferenceRemove(action: ReferenceRemoveAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, useTriggeredItem = true, referenceId } = action.config;

    const resolvedItemId = await this.resolveItemId(itemId, undefined, useTriggeredItem, ctx);
    const resolvedRefId = await this.templateResolver.resolveString(referenceId, ctx);

    await this.onstaqClient.deleteReference(resolvedItemId, resolvedRefId);
    logger.info(`Removed reference ${resolvedRefId} from item ${resolvedItemId}`);
    return { deletedReferenceId: resolvedRefId };
  }

  private async executeCommentAdd(action: CommentAddAction, ctx: ExecutionContext): Promise<any> {
    const { itemId, useTriggeredItem = true, body } = action.config;

    const targetId = await this.resolveItemId(itemId, undefined, useTriggeredItem, ctx);
    const resolvedBody = await this.templateResolver.resolveString(body, ctx);

    const comment = await this.onstaqClient.addComment(targetId, resolvedBody);
    logger.info(`Added comment to item ${targetId}`);
    return { commentId: comment.id };
  }

  private async executeItemImport(action: ItemImportAction, ctx: ExecutionContext): Promise<any> {
    const { catalogId, catalogName, keyColumn, rows } = action.config;

    let resolvedCatalogId = catalogId;
    if (!resolvedCatalogId && catalogName) {
      resolvedCatalogId = await this.resolveCatalogId(catalogName, ctx.workspaceId);
    }
    if (!resolvedCatalogId) {
      throw new Error('item.import requires catalogId or catalogName');
    }

    const resolvedRows = await this.templateResolver.resolveValue(rows, ctx);
    const result = await this.onstaqClient.importItems(resolvedCatalogId, resolvedRows, keyColumn);

    logger.info(`Imported ${result.created} created, ${result.updated} updated, ${result.skipped} skipped`);
    return result;
  }

  private async executeCatalogCreate(action: CatalogCreateAction, ctx: ExecutionContext): Promise<any> {
    const { workspaceId, name, description, icon, isAbstract, parentTypeId } = action.config;

    const catalog = await this.onstaqClient.createCatalog({
      workspaceId: workspaceId || ctx.workspaceId,
      name,
      description,
      icon,
      isAbstract,
      parentTypeId,
    });

    logger.info(`Created catalog "${name}" (${catalog.id})`);
    return { catalogId: catalog.id, catalogName: catalog.name };
  }

  private async executeAttributeCreate(action: AttributeCreateAction, ctx: ExecutionContext): Promise<any> {
    const { catalogId, catalogName, name, type, isRequired, config } = action.config;

    let resolvedCatalogId = catalogId;
    if (!resolvedCatalogId && catalogName) {
      resolvedCatalogId = await this.resolveCatalogId(catalogName, ctx.workspaceId);
    }
    if (!resolvedCatalogId) {
      throw new Error('attribute.create requires catalogId or catalogName');
    }

    const attribute = await this.onstaqClient.createAttribute({
      catalogId: resolvedCatalogId,
      name,
      type: type as any,
      isRequired,
      config,
    });

    logger.info(`Created attribute "${name}" (${type}) on catalog ${resolvedCatalogId}`);
    return { attributeId: attribute.id };
  }

  private async executeWorkspaceMemberAdd(action: WorkspaceMemberAddAction, ctx: ExecutionContext): Promise<any> {
    const { workspaceId, userId, role } = action.config;

    const resolvedUserId = await this.templateResolver.resolveString(userId, ctx);
    const member = await this.onstaqClient.addMember(
      workspaceId || ctx.workspaceId,
      resolvedUserId,
      role as any
    );

    logger.info(`Added user ${resolvedUserId} to workspace with role ${role}`);
    return { memberId: member.id };
  }

  private async executeOql(action: OqlExecuteAction, ctx: ExecutionContext): Promise<any> {
    const { query, workspaceId, storeResultAs } = action.config;

    const resolvedQuery = await this.templateResolver.resolveString(query, ctx);
    const result = await this.onstaqClient.executeOql(resolvedQuery, workspaceId || ctx.workspaceId);

    if (storeResultAs) {
      ctx.variables[storeResultAs] = result;
    }

    logger.info(`OQL executed: ${result.totalCount} rows in ${result.executionTimeMs}ms`);
    return {
      totalCount: result.totalCount,
      executionTimeMs: result.executionTimeMs,
      rows: result.rows,
    };
  }

  private async executeWebhookSend(action: WebhookSendAction, ctx: ExecutionContext): Promise<any> {
    const { url, method = 'POST', headers, body } = action.config;

    const resolvedUrl = await this.templateResolver.resolveString(url, ctx);
    const resolvedHeaders = headers ? await this.templateResolver.resolveValue(headers, ctx) : {};
    const resolvedBody = body ? await this.templateResolver.resolveValue(body, ctx) : undefined;

    const response = await axios({
      method,
      url: resolvedUrl,
      headers: resolvedHeaders,
      data: resolvedBody,
      timeout: 10000,
    });

    logger.info(`Webhook sent to ${resolvedUrl}: ${response.status}`);
    return { status: response.status, statusText: response.statusText };
  }

  private async executeAutomationTrigger(action: AutomationTriggerAction, ctx: ExecutionContext): Promise<any> {
    if (!this.triggerAutomation) {
      throw new Error('Automation chaining not configured');
    }

    const { automationId, parameters } = action.config;
    const resolvedParams = parameters ? await this.templateResolver.resolveValue(parameters, ctx) : undefined;

    await this.triggerAutomation(automationId, resolvedParams);
    logger.info(`Chained trigger for automation ${automationId}`);
    return { triggeredAutomationId: automationId };
  }

  private async executeVariableSet(action: VariableSetAction, ctx: ExecutionContext): Promise<any> {
    const { name, value } = action.config;
    const resolvedValue = await this.templateResolver.resolveString(value, ctx);

    ctx.variables[name] = resolvedValue;
    logger.info(`Set variable "${name}" = "${resolvedValue}"`);
    return { name, value: resolvedValue };
  }

  private async executeLog(action: LogAction, ctx: ExecutionContext): Promise<any> {
    const { message } = action.config;
    const resolvedMessage = await this.templateResolver.resolveString(message, ctx);

    logger.info(`[Automation Log] ${ctx.automationName}: ${resolvedMessage}`);
    return { message: resolvedMessage };
  }

  private async executeRefetchData(_action: RefetchDataAction, ctx: ExecutionContext): Promise<any> {
    const item = ctx.currentItem || ctx.trigger.item;
    if (!item) {
      throw new Error('No item in context to refetch');
    }

    const refreshed = await this.onstaqClient.getItem(item.id);

    // Update the context
    if (ctx.currentItem) {
      ctx.currentItem = refreshed;
    }
    if (ctx.trigger.item && ctx.trigger.item.id === refreshed.id) {
      ctx.trigger.item = refreshed;
    }

    logger.info(`Refetched data for item ${refreshed.key}`);
    return { itemId: refreshed.id, itemKey: refreshed.key };
  }

  // ---- Helpers ----

  private async resolveItemId(
    itemId: string | undefined,
    itemKey: string | undefined,
    useTriggeredItem: boolean,
    ctx: ExecutionContext
  ): Promise<string> {
    if (itemId) {
      return this.templateResolver.resolveString(itemId, ctx);
    }
    if (itemKey) {
      const resolvedKey = await this.templateResolver.resolveString(itemKey, ctx);
      const items = await this.onstaqClient.listItems({ key: resolvedKey, workspaceId: ctx.workspaceId });
      if (items.data.length === 0) throw new Error(`Item not found with key: ${resolvedKey}`);
      return items.data[0].id;
    }
    // Prefer currentItem (branch context) over trigger item
    if (useTriggeredItem) {
      if (ctx.currentItem?.id) return ctx.currentItem.id;
      if (ctx.trigger.item?.id) return ctx.trigger.item.id;
    }
    throw new Error('Cannot resolve item ID: no itemId, itemKey, or triggered item available');
  }

  private async resolveCatalogId(catalogName: string, workspaceId: string): Promise<string> {
    const catalogs = await this.onstaqClient.listCatalogs(workspaceId);
    const match = catalogs.find((c) => c.name.toLowerCase() === catalogName.toLowerCase());
    if (!match) throw new Error(`Catalog not found: "${catalogName}"`);
    return match.id;
  }
}

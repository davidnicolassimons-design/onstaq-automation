// =============================================================================
// Template Variable Resolver
// Resolves {{variable}} expressions in action configs using execution context.
// Enhanced with Jira-style smart values: function chaining, blocks, pipes.
// =============================================================================

import { ExecutionContext } from './types';
import { OnstaqClient } from '../onstaq/client';
import { logger } from '../utils/logger';
import {
  ExpressionParser,
  ExpressionEvaluator,
  BlockProcessor,
  createDefaultRegistry,
  FunctionRegistry,
  FunctionContext,
  LegacyResolver,
} from './smart-values';

const TEMPLATE_REGEX = /\{\{(.+?)\}\}/g;
const OQL_PREFIX = 'oql:';
const BLOCK_TAG_REGEX = /\{\{#(each|if)\s/;

export class TemplateResolver {
  private onstaqClient: OnstaqClient;
  private parser: ExpressionParser;
  private evaluator: ExpressionEvaluator;
  private registry: FunctionRegistry;
  private blockProcessor: BlockProcessor;

  constructor(onstaqClient: OnstaqClient) {
    this.onstaqClient = onstaqClient;
    this.parser = new ExpressionParser();
    this.registry = createDefaultRegistry();

    const legacy: LegacyResolver = {
      resolvePath: (expression, ctx) => this.resolveExpressionLegacy(expression, ctx),
      resolveOql: (query, ctx) => this.resolveOql(query, ctx),
      lookupItem: (key, ctx) => this.lookupItem(key, ctx),
    };

    this.evaluator = new ExpressionEvaluator(this.registry, legacy);

    this.blockProcessor = new BlockProcessor(
      (expression, ctx) => this.resolveExpressionSmart(expression, ctx),
    );
  }

  /**
   * Resolve all templates in a string value.
   */
  async resolveString(template: string, ctx: ExecutionContext): Promise<string> {
    if (!template || typeof template !== 'string') return template;
    if (!template.includes('{{')) return template;

    // Phase 1: Process block helpers ({{#each}}, {{#if}}) if present
    let processed = template;
    if (BLOCK_TAG_REGEX.test(template)) {
      processed = await this.blockProcessor.processBlocks(template, ctx);
    }

    // Phase 2: Resolve individual {{expression}} tokens
    const matches = [...processed.matchAll(TEMPLATE_REGEX)];
    let result = processed;

    for (const match of matches) {
      const fullMatch = match[0];
      const expression = match[1].trim();

      if (expression.startsWith('#') || expression.startsWith('/') || expression === 'else') {
        continue;
      }

      const resolved = await this.resolveExpressionSmart(expression, ctx);
      result = result.replace(fullMatch, this.stringify(resolved));
    }

    return result;
  }

  /**
   * Deep-resolve templates in any value (string, object, array).
   */
  async resolveValue(value: any, ctx: ExecutionContext): Promise<any> {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      return this.resolveString(value, ctx);
    }

    if (Array.isArray(value)) {
      return Promise.all(value.map((v) => this.resolveValue(v, ctx)));
    }

    if (typeof value === 'object') {
      const resolved: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = await this.resolveValue(val, ctx);
      }
      return resolved;
    }

    return value;
  }

  /**
   * Smart expression resolver: tries the new parser/evaluator first,
   * falls back to legacy on parse failure for full backward compatibility.
   */
  private async resolveExpressionSmart(expression: string, ctx: ExecutionContext): Promise<any> {
    try {
      const ast = this.parser.parse(expression);
      const functionContext: FunctionContext = {
        onstaqClient: this.onstaqClient,
        executionContext: ctx,
      };
      return await this.evaluator.evaluate(ast, ctx, functionContext);
    } catch (err: any) {
      logger.debug(`Smart value parse fallback for "${expression}": ${err.message}`);
      return this.resolveExpressionLegacy(expression, ctx);
    }
  }

  /**
   * Legacy expression resolver (original logic, kept as fallback).
   */
  private async resolveExpressionLegacy(expression: string, ctx: ExecutionContext): Promise<any> {
    // OQL inline queries
    if (expression.startsWith(OQL_PREFIX)) {
      return this.resolveOql(expression.slice(OQL_PREFIX.length).trim(), ctx);
    }

    // Navigate the context using dot notation
    const path = expression.split('.');
    const root = path[0];

    switch (root) {
      case 'trigger':
        return this.resolveTriggerPath(path.slice(1), ctx);

      case 'item':
      case 'currentItem':
        return this.resolveCurrentItemPath(path.slice(1), ctx);

      case 'env':
        return this.resolveEnv(path[1]);

      case 'context':
        return this.resolveContextPath(path.slice(1), ctx);

      case 'variables':
        return this.navigatePath(ctx.variables, path.slice(1));

      case 'action':
        return this.resolveActionResult(path, ctx);

      default:
        logger.warn(`Unknown template root: ${root} in expression: ${expression}`);
        return `{{${expression}}}`;
    }
  }

  private resolveTriggerPath(path: string[], ctx: ExecutionContext): any {
    const trigger = ctx.trigger;
    if (!path.length) return trigger;

    const segment = path[0];

    switch (segment) {
      case 'item':
        return this.navigatePath(trigger.item, path.slice(1));
      case 'previous':
        return this.navigatePath(trigger.previousValues, path.slice(1));
      case 'user':
        return this.navigatePath(trigger.item?.createdBy || trigger.item?.updatedBy, path.slice(1));
      case 'timestamp':
        return trigger.timestamp;
      case 'type':
        return trigger.type;
      case 'manualParameters':
        return this.navigatePath(trigger.manualParameters, path.slice(1));
      case 'webhookPayload':
        return this.navigatePath(trigger.webhookPayload, path.slice(1));
      case 'oqlResults':
        return trigger.oqlResults;
      default:
        return this.navigatePath(trigger, path);
    }
  }

  private resolveEnv(key: string): any {
    switch (key) {
      case 'NOW':
        return new Date().toISOString();
      case 'TODAY':
        return new Date().toISOString().split('T')[0];
      default:
        return undefined;
    }
  }

  private resolveContextPath(path: string[], ctx: ExecutionContext): any {
    if (path[0] === 'variables') {
      return this.navigatePath(ctx.variables, path.slice(1));
    }
    return this.navigatePath(ctx, path);
  }

  private resolveCurrentItemPath(path: string[], ctx: ExecutionContext): any {
    // Falls back to trigger item when not in a branch
    const item = ctx.currentItem || ctx.trigger.item;
    if (!item) return undefined;
    if (!path.length) return item;
    return this.navigatePath(item, path);
  }

  private resolveActionResult(path: string[], ctx: ExecutionContext): any {
    // Smart parser sends just ["action"] — return the full array for chain evaluation
    if (path.length === 1 && path[0] === 'action') {
      return ctx.componentResults;
    }
    // Legacy: action[0].result.field (dot-split gives "action[0]" as first segment)
    const match = path[0].match(/^action\[(\d+)\]$/);
    if (match) {
      const index = parseInt(match[1], 10);
      const componentResult = ctx.componentResults[index];
      if (!componentResult) return undefined;
      return this.navigatePath(componentResult, path.slice(1));
    }
    return undefined;
  }

  private async resolveOql(query: string, ctx: ExecutionContext): Promise<any> {
    try {
      // Resolve any nested templates in the OQL query itself
      const resolvedQuery = await this.resolveString(query, ctx);
      logger.debug(`Resolving inline OQL: ${resolvedQuery} (workspace: ${ctx.workspaceId})`);

      const result = await this.onstaqClient.executeOql(resolvedQuery, ctx.workspaceId);

      // Defensive: handle missing or unexpected response shape
      const rows = result?.rows ?? [];
      const columns = result?.columns ?? [];

      if (rows.length === 0) return null;

      // Single scalar result (e.g. SELECT COUNT(*))
      if (rows.length === 1 && columns.length === 1) {
        const col = columns[0].name;
        return rows[0][col];
      }

      // Single row — return as object
      if (rows.length === 1) return rows[0];

      // Multiple rows — return as array
      return rows;
    } catch (err: any) {
      logger.error(`OQL template resolution failed for query "${query}": ${err.message}`);
      throw new Error(`OQL template error: ${err.message}`);
    }
  }

  /**
   * Lookup an item by its key (e.g., "TM-1234") for cross-item references.
   */
  private async lookupItem(key: string, ctx: ExecutionContext): Promise<any> {
    try {
      logger.debug(`Looking up item by key: ${key} (workspace: ${ctx.workspaceId})`);
      const result = await this.onstaqClient.listItems({
        key,
        workspaceId: ctx.workspaceId,
        limit: 1,
      });
      if (result.data && result.data.length > 0) {
        return result.data[0];
      }
      logger.warn(`Item not found for key: ${key}`);
      return null;
    } catch (err: any) {
      logger.error(`Item lookup failed for key "${key}": ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate a nested object by path segments.
   */
  private navigatePath(obj: any, path: string[]): any {
    if (!obj || !path.length) return obj;

    let current = obj;
    for (const segment of path) {
      if (current === null || current === undefined) return undefined;

      // Handle attributeValues specially
      if (segment === 'attributes' && current.attributeValues) {
        current = current.attributeValues;
        continue;
      }

      // Array index access: field[0]
      const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/);
      if (arrayMatch) {
        current = current[arrayMatch[1]];
        if (Array.isArray(current)) {
          current = current[parseInt(arrayMatch[2], 10)];
        }
        continue;
      }

      current = current[segment];
    }

    return current;
  }

  /**
   * Convert any value to string for template replacement.
   */
  private stringify(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value);
  }
}

// =============================================================================
// Template Variable Resolver
// Resolves {{variable}} expressions in action configs using execution context
// =============================================================================

import { ExecutionContext } from './types';
import { OnstaqClient } from '../onstaq/client';
import { logger } from '../utils/logger';

/**
 * Resolve all template variables in a value.
 * Supports:
 *   {{trigger.item.id}}
 *   {{trigger.item.key}}
 *   {{trigger.item.attributes.FieldName}}
 *   {{trigger.previous.FieldName}}
 *   {{trigger.user.name}}
 *   {{trigger.timestamp}}
 *   {{trigger.manualParameters.paramName}}
 *   {{trigger.webhookPayload.field.nested}}
 *   {{env.NOW}}
 *   {{env.TODAY}}
 *   {{context.variables.resultName}}
 *   {{action[0].result.field}}
 *   {{oql:FROM Catalog WHERE ... SELECT COUNT(*)}}
 */

const TEMPLATE_REGEX = /\{\{(.+?)\}\}/g;
const OQL_PREFIX = 'oql:';

export class TemplateResolver {
  private onstaqClient: OnstaqClient;

  constructor(onstaqClient: OnstaqClient) {
    this.onstaqClient = onstaqClient;
  }

  /**
   * Resolve all templates in a string value.
   */
  async resolveString(template: string, ctx: ExecutionContext): Promise<string> {
    if (!template || typeof template !== 'string') return template;
    if (!template.includes('{{')) return template;

    const matches = [...template.matchAll(TEMPLATE_REGEX)];
    let result = template;

    for (const match of matches) {
      const fullMatch = match[0];
      const expression = match[1].trim();
      const resolved = await this.resolveExpression(expression, ctx);
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
   * Resolve a single expression (the part inside {{ }}).
   */
  private async resolveExpression(expression: string, ctx: ExecutionContext): Promise<any> {
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

      case 'env':
        return this.resolveEnv(path[1]);

      case 'context':
        return this.resolveContextPath(path.slice(1), ctx);

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

  private resolveActionResult(path: string[], ctx: ExecutionContext): any {
    // action[0].result.field
    const match = path[0].match(/^action\[(\d+)\]$/);
    if (match) {
      const index = parseInt(match[1], 10);
      const actionResult = ctx.actionResults[index];
      if (!actionResult) return undefined;
      return this.navigatePath(actionResult, path.slice(1));
    }
    return undefined;
  }

  private async resolveOql(query: string, ctx: ExecutionContext): Promise<any> {
    try {
      // Resolve any nested templates in the OQL query itself
      const resolvedQuery = await this.resolveString(query, ctx);
      const result = await this.onstaqClient.executeOql(resolvedQuery, ctx.workspaceId);
      // Return the rows (or single value if COUNT etc.)
      if (result.rows.length === 1 && result.columns.length === 1) {
        const col = result.columns[0].name;
        return result.rows[0][col];
      }
      return result.rows;
    } catch (err: any) {
      logger.error(`OQL template resolution failed: ${err.message}`);
      return `[OQL_ERROR: ${err.message}]`;
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

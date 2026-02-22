// =============================================================================
// Block Processor
// Handles {{#each}} and {{#if}} block expansion before expression resolution
// =============================================================================

import { ExecutionContext, Item } from '../types';
import { logger } from '../../utils/logger';

const MAX_ITERATIONS = 100;

/**
 * Callback to resolve a single expression (the content inside {{ }}).
 * Used by block processor to evaluate conditions and iteration targets.
 */
export type ExpressionResolverFn = (expression: string, ctx: ExecutionContext) => Promise<any>;

export class BlockProcessor {
  private resolveExpression: ExpressionResolverFn;

  constructor(resolveExpression: ExpressionResolverFn) {
    this.resolveExpression = resolveExpression;
  }

  /**
   * Process all block helpers in a template string.
   * Handles {{#each}}, {{#if}}, {{else}}, {{/each}}, {{/if}}.
   * Processes innermost blocks first, iterating until no blocks remain.
   */
  async processBlocks(template: string, ctx: ExecutionContext): Promise<string> {
    let result = template;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      // Try to find and process an innermost #each block
      const eachProcessed = await this.processInnermostEach(result, ctx);
      if (eachProcessed !== null) {
        result = eachProcessed;
        iterations++;
        continue;
      }

      // Try to find and process an innermost #if block
      const ifProcessed = await this.processInnermostIf(result, ctx);
      if (ifProcessed !== null) {
        result = ifProcessed;
        iterations++;
        continue;
      }

      // No more blocks to process
      break;
    }

    if (iterations >= MAX_ITERATIONS) {
      logger.warn('Block processor hit maximum iteration limit');
    }

    return result;
  }

  /**
   * Find and process the innermost {{#each}} block (one with no nested #each inside).
   * Returns the modified template, or null if no #each block found.
   */
  private async processInnermostEach(template: string, ctx: ExecutionContext): Promise<string | null> {
    // Find the last {{#each ...}} that has a matching {{/each}} with no nested {{#each}} inside
    const openRegex = /\{\{#each\s+(.+?)\}\}/g;
    const closeTag = '{{/each}}';

    let match: RegExpExecArray | null;
    let lastInnermost: { openStart: number; openEnd: number; expression: string } | null = null;

    while ((match = openRegex.exec(template)) !== null) {
      const openStart = match.index;
      const openEnd = match.index + match[0].length;
      const expression = match[1].trim();

      // Find the corresponding {{/each}}
      const closeIndex = template.indexOf(closeTag, openEnd);
      if (closeIndex === -1) continue;

      // Check if there's a nested {{#each}} inside the body
      const body = template.substring(openEnd, closeIndex);
      if (!body.includes('{{#each')) {
        lastInnermost = { openStart, openEnd, expression };
      }
    }

    if (!lastInnermost) return null;

    const { openStart, openEnd, expression } = lastInnermost;
    const closeIndex = template.indexOf(closeTag, openEnd);
    const body = template.substring(openEnd, closeIndex);
    const afterClose = closeIndex + closeTag.length;

    // Resolve the expression to an array
    const collection = await this.resolveExpression(expression, ctx);
    const items = Array.isArray(collection) ? collection : collection ? [collection] : [];

    // Expand the body for each item
    const parts: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Create a child context with currentItem set
      const childCtx: ExecutionContext = {
        ...ctx,
        currentItem: item as Item,
        variables: {
          ...ctx.variables,
          '@index': i,
          '@first': i === 0,
          '@last': i === items.length - 1,
        },
      };

      // Leave inner {{expressions}} intact for the expression pass to resolve later
      // But replace {{@index}}, {{@first}}, {{@last}} immediately
      let expandedBody = body;
      expandedBody = expandedBody.replace(/\{\{@index\}\}/g, String(i));
      expandedBody = expandedBody.replace(/\{\{@first\}\}/g, String(i === 0));
      expandedBody = expandedBody.replace(/\{\{@last\}\}/g, String(i === items.length - 1));

      // Replace {{currentItem...}} references by resolving against the child context
      // We need to resolve these here since each iteration has a different currentItem
      const itemExprRegex = /\{\{(currentItem(?:\.[^}]+)?)\}\}/g;
      let itemMatch: RegExpExecArray | null;
      let resolved = expandedBody;

      while ((itemMatch = itemExprRegex.exec(expandedBody)) !== null) {
        const fullMatch = itemMatch[0];
        const expr = itemMatch[1].trim();
        const value = await this.resolveExpression(expr, childCtx);
        resolved = resolved.replace(fullMatch, this.stringify(value));
      }

      parts.push(resolved);
    }

    return template.substring(0, openStart) + parts.join('') + template.substring(afterClose);
  }

  /**
   * Find and process the innermost {{#if}} block.
   * Returns the modified template, or null if no #if block found.
   */
  private async processInnermostIf(template: string, ctx: ExecutionContext): Promise<string | null> {
    const openRegex = /\{\{#if\s+(.+?)\}\}/g;
    const closeTag = '{{/if}}';

    let match: RegExpExecArray | null;
    let lastInnermost: { openStart: number; openEnd: number; expression: string } | null = null;

    while ((match = openRegex.exec(template)) !== null) {
      const openStart = match.index;
      const openEnd = match.index + match[0].length;
      const expression = match[1].trim();

      const closeIndex = template.indexOf(closeTag, openEnd);
      if (closeIndex === -1) continue;

      const body = template.substring(openEnd, closeIndex);
      if (!body.includes('{{#if')) {
        lastInnermost = { openStart, openEnd, expression };
      }
    }

    if (!lastInnermost) return null;

    const { openStart, openEnd, expression } = lastInnermost;
    const closeIndex = template.indexOf(closeTag, openEnd);
    const body = template.substring(openEnd, closeIndex);
    const afterClose = closeIndex + closeTag.length;

    // Split on {{else}}
    const elseIndex = body.indexOf('{{else}}');
    const thenBody = elseIndex >= 0 ? body.substring(0, elseIndex) : body;
    const elseBody = elseIndex >= 0 ? body.substring(elseIndex + '{{else}}'.length) : '';

    // Evaluate condition
    const conditionResult = await this.evaluateCondition(expression, ctx);
    const selectedBody = conditionResult ? thenBody : elseBody;

    return template.substring(0, openStart) + selectedBody + template.substring(afterClose);
  }

  /**
   * Evaluate a condition expression.
   * Supports:
   *   {{#if path}}                     — truthiness check
   *   {{#if path == "value"}}          — equality
   *   {{#if path != "value"}}          — inequality
   *   {{#if path > value}}             — comparison
   *   {{#if path < value}}             — comparison
   *   {{#if path >= value}}            — comparison
   *   {{#if path <= value}}            — comparison
   */
  private async evaluateCondition(expression: string, ctx: ExecutionContext): Promise<boolean> {
    // Check for comparison operators
    const compMatch = expression.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);

    if (compMatch) {
      const leftExpr = compMatch[1].trim();
      const operator = compMatch[2];
      const rightExpr = compMatch[3].trim();

      const leftVal = await this.resolveConditionValue(leftExpr, ctx);
      const rightVal = await this.resolveConditionValue(rightExpr, ctx);

      switch (operator) {
        // eslint-disable-next-line eqeqeq
        case '==': return leftVal == rightVal;
        // eslint-disable-next-line eqeqeq
        case '!=': return leftVal != rightVal;
        case '>': return Number(leftVal) > Number(rightVal);
        case '<': return Number(leftVal) < Number(rightVal);
        case '>=': return Number(leftVal) >= Number(rightVal);
        case '<=': return Number(leftVal) <= Number(rightVal);
        default: return false;
      }
    }

    // Simple truthiness check
    const value = await this.resolveExpression(expression, ctx);
    return this.isTruthy(value);
  }

  /**
   * Resolve a value from a condition expression.
   * Handles quoted strings as literals, numbers as literals, and paths as expressions.
   */
  private async resolveConditionValue(expr: string, ctx: ExecutionContext): Promise<any> {
    // Quoted string literal
    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    // Number literal
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return parseFloat(expr);
    }

    // Boolean literal
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;

    // Otherwise resolve as an expression
    return this.resolveExpression(expr, ctx);
  }

  private isTruthy(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (value === false) return false;
    if (value === 0) return false;
    if (value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }

  private stringify(value: any): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    return JSON.stringify(value);
  }
}

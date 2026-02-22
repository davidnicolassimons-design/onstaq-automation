// =============================================================================
// Expression Evaluator
// Walks AST nodes, resolves paths, dispatches functions
// =============================================================================

import {
  ASTNode, FunctionContext,
} from './smart-value-types';
import { FunctionRegistry } from './functions/index';
import { logger } from '../../utils/logger';

/**
 * Callback to resolve legacy path expressions and OQL queries
 * through the existing TemplateResolver logic.
 */
export interface LegacyResolver {
  resolvePath(expression: string, ctx: any): Promise<any>;
  resolveOql(query: string, ctx: any): Promise<any>;
  lookupItem(key: string, ctx: any): Promise<any>;
}

export class ExpressionEvaluator {
  private registry: FunctionRegistry;
  private legacy: LegacyResolver;

  constructor(registry: FunctionRegistry, legacy: LegacyResolver) {
    this.registry = registry;
    this.legacy = legacy;
  }

  async evaluate(node: ASTNode, ctx: any, functionContext?: FunctionContext): Promise<any> {
    switch (node.type) {
      case 'path':
        return this.evaluatePath(node, ctx);

      case 'chain':
        return this.evaluateChain(node, ctx, functionContext);

      case 'functionCall':
        return this.evaluateFunctionCall(node, ctx, functionContext);

      case 'literal':
        return node.value;

      case 'pipe':
        return this.evaluatePipe(node, ctx, functionContext);

      case 'binary':
        return this.evaluateBinary(node, ctx, functionContext);

      case 'oql':
        return this.legacy.resolveOql(node.query, ctx);

      default:
        logger.warn(`Unknown AST node type: ${(node as any).type}`);
        return undefined;
    }
  }

  private async evaluatePath(node: { type: 'path'; segments: string[] }, ctx: any): Promise<any> {
    // Delegate to legacy resolver which already handles all path navigation
    const expression = node.segments.join('.');
    return this.legacy.resolvePath(expression, ctx);
  }

  private async evaluateChain(
    node: { type: 'chain'; base: ASTNode; operations: any[] },
    ctx: any,
    functionContext?: FunctionContext,
  ): Promise<any> {
    let value = await this.evaluate(node.base, ctx, functionContext);

    for (const op of node.operations) {
      switch (op.type) {
        case 'functionCall': {
          const fn = this.registry.get(op.name);
          if (!fn) {
            throw new Error(`Unknown function: ${op.name}`);
          }

          // Validate arg count
          const resolvedArgs = await Promise.all(
            op.args.map((arg: ASTNode) => this.evaluate(arg, ctx, functionContext)),
          );
          if (resolvedArgs.length < fn.minArgs || resolvedArgs.length > fn.maxArgs) {
            throw new Error(
              `Function ${op.name} expects ${fn.minArgs}-${fn.maxArgs} args, got ${resolvedArgs.length}`,
            );
          }

          value = await fn.execute(value, resolvedArgs, functionContext);
          break;
        }

        case 'propertyAccess': {
          // Check if it's a zero-arg function (e.g., .length, .isEmpty, .first)
          const fn = this.registry.get(op.name);
          if (fn && fn.minArgs === 0) {
            value = await fn.execute(value, [], functionContext);
          } else if (value != null && typeof value === 'object') {
            // Handle attributeValues alias
            if (op.name === 'attributes' && value.attributeValues) {
              value = value.attributeValues;
            } else {
              value = value[op.name];
            }
          } else {
            value = undefined;
          }
          break;
        }

        case 'indexAccess': {
          const index = await this.evaluate(op.index, ctx, functionContext);
          if (Array.isArray(value)) {
            value = value[Number(index)];
          } else if (value != null && typeof value === 'object') {
            value = value[String(index)];
          } else {
            value = undefined;
          }
          break;
        }

        default:
          logger.warn(`Unknown chain operation type: ${op.type}`);
          value = undefined;
      }
    }

    return value;
  }

  private async evaluateFunctionCall(
    node: { type: 'functionCall'; name: string; args: ASTNode[] },
    ctx: any,
    functionContext?: FunctionContext,
  ): Promise<any> {
    // Special top-level functions
    if (node.name === 'lookup') {
      if (node.args.length < 1) {
        throw new Error('lookup() requires at least 1 argument (item key)');
      }
      const key = await this.evaluate(node.args[0], ctx, functionContext);
      return this.legacy.lookupItem(String(key), ctx);
    }

    // Check registry for static functions (e.g., now())
    const fn = this.registry.get(node.name);
    if (fn) {
      const resolvedArgs = await Promise.all(
        node.args.map((arg) => this.evaluate(arg, ctx, functionContext)),
      );
      // For top-level calls, value is null (no piped value)
      return fn.execute(null, resolvedArgs, functionContext);
    }

    throw new Error(`Unknown function: ${node.name}`);
  }

  private async evaluatePipe(
    node: { type: 'pipe'; left: ASTNode; right: ASTNode },
    ctx: any,
    functionContext?: FunctionContext,
  ): Promise<any> {
    const left = await this.evaluate(node.left, ctx, functionContext);

    // Null-coalescing: if left is null, undefined, or empty string, use right
    if (left === null || left === undefined || left === '') {
      return this.evaluate(node.right, ctx, functionContext);
    }

    return left;
  }

  private async evaluateBinary(
    node: { type: 'binary'; operator: string; left: ASTNode; right: ASTNode },
    ctx: any,
    functionContext?: FunctionContext,
  ): Promise<any> {
    const left = await this.evaluate(node.left, ctx, functionContext);
    const right = await this.evaluate(node.right, ctx, functionContext);

    switch (node.operator) {
      case '+': {
        // String concatenation if either side is a string
        if (typeof left === 'string' || typeof right === 'string') {
          return String(left ?? '') + String(right ?? '');
        }
        return Number(left) + Number(right);
      }
      case '-': return Number(left) - Number(right);
      case '*': return Number(left) * Number(right);
      case '/': {
        const divisor = Number(right);
        if (divisor === 0) throw new Error('Division by zero');
        return Number(left) / divisor;
      }
      // eslint-disable-next-line eqeqeq
      case '==': return left == right;
      // eslint-disable-next-line eqeqeq
      case '!=': return left != right;
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
      default:
        throw new Error(`Unknown operator: ${node.operator}`);
    }
  }
}

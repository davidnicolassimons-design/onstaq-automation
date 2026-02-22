// =============================================================================
// Condition Evaluator
// Evaluates condition trees (AND/OR/NOT with nested conditions)
// =============================================================================

import {
  ConditionConfig, ConditionGroup, SingleCondition,
  AttributeCondition, OqlCondition, ReferenceCondition,
  TemplateCondition, ExecutionContext, ConditionOperator
} from './types';
import { OnstaqClient } from '../onstaq/client';
import { TemplateResolver } from './template-resolver';
import { logger } from '../utils/logger';

export interface ConditionResult {
  passed: boolean;
  details: Record<string, any>;
}

export class ConditionEvaluator {
  private onstaqClient: OnstaqClient;
  private templateResolver: TemplateResolver;

  constructor(onstaqClient: OnstaqClient, templateResolver: TemplateResolver) {
    this.onstaqClient = onstaqClient;
    this.templateResolver = templateResolver;
  }

  /**
   * Evaluate the full condition config. Returns true if no conditions defined.
   */
  async evaluate(condition: ConditionConfig | null | undefined, ctx: ExecutionContext): Promise<ConditionResult> {
    if (!condition) {
      return { passed: true, details: { reason: 'No conditions defined' } };
    }

    try {
      const passed = await this.evaluateNode(condition, ctx);
      return {
        passed,
        details: { condition, evaluatedAt: new Date().toISOString() }
      };
    } catch (err: any) {
      logger.error(`Condition evaluation failed: ${err.message}`);
      return {
        passed: false,
        details: { error: err.message, condition }
      };
    }
  }

  private async evaluateNode(node: ConditionConfig, ctx: ExecutionContext): Promise<boolean> {
    if (this.isConditionGroup(node)) {
      return this.evaluateGroup(node, ctx);
    }
    return this.evaluateSingle(node, ctx);
  }

  private async evaluateGroup(group: ConditionGroup, ctx: ExecutionContext): Promise<boolean> {
    const { operator, conditions } = group;

    switch (operator) {
      case 'AND': {
        for (const cond of conditions) {
          if (!(await this.evaluateNode(cond, ctx))) return false;
        }
        return true;
      }
      case 'OR': {
        for (const cond of conditions) {
          if (await this.evaluateNode(cond, ctx)) return true;
        }
        return false;
      }
      case 'NOT': {
        if (conditions.length !== 1) {
          throw new Error('NOT operator requires exactly one condition');
        }
        return !(await this.evaluateNode(conditions[0], ctx));
      }
      default:
        throw new Error(`Unknown condition group operator: ${operator}`);
    }
  }

  private async evaluateSingle(condition: SingleCondition, ctx: ExecutionContext): Promise<boolean> {
    switch (condition.type) {
      case 'attribute':
        return this.evaluateAttribute(condition, ctx);
      case 'oql':
        return this.evaluateOql(condition, ctx);
      case 'reference':
        return this.evaluateReference(condition, ctx);
      case 'template':
        return this.evaluateTemplate(condition, ctx);
      default:
        throw new Error(`Unknown condition type: ${(condition as any).type}`);
    }
  }

  // ---- Attribute Conditions ----

  private async evaluateAttribute(condition: AttributeCondition, ctx: ExecutionContext): Promise<boolean> {
    const item = ctx.trigger.item;
    if (!item) return false;

    const currentValue = item.attributeValues?.[condition.field];
    const previousValue = ctx.trigger.previousValues?.[condition.field];

    return this.compareValue(condition.operator, currentValue, condition.value, previousValue, condition.from, condition.to);
  }

  private compareValue(
    operator: ConditionOperator,
    currentValue: any,
    targetValue: any,
    previousValue?: any,
    fromValue?: any,
    toValue?: any
  ): boolean {
    switch (operator) {
      case 'equals':
        return this.looseEquals(currentValue, targetValue);
      case 'not_equals':
        return !this.looseEquals(currentValue, targetValue);
      case 'contains':
        return String(currentValue || '').toLowerCase().includes(String(targetValue || '').toLowerCase());
      case 'not_contains':
        return !String(currentValue || '').toLowerCase().includes(String(targetValue || '').toLowerCase());
      case 'starts_with':
        return String(currentValue || '').toLowerCase().startsWith(String(targetValue || '').toLowerCase());
      case 'ends_with':
        return String(currentValue || '').toLowerCase().endsWith(String(targetValue || '').toLowerCase());
      case 'greater_than':
        return Number(currentValue) > Number(targetValue);
      case 'less_than':
        return Number(currentValue) < Number(targetValue);
      case 'greater_than_or_equal':
        return Number(currentValue) >= Number(targetValue);
      case 'less_than_or_equal':
        return Number(currentValue) <= Number(targetValue);
      case 'in':
        return Array.isArray(targetValue) && targetValue.some((v: any) => this.looseEquals(currentValue, v));
      case 'not_in':
        return Array.isArray(targetValue) && !targetValue.some((v: any) => this.looseEquals(currentValue, v));
      case 'is_null':
        return currentValue === null || currentValue === undefined || currentValue === '';
      case 'is_not_null':
        return currentValue !== null && currentValue !== undefined && currentValue !== '';
      case 'changed_to':
        return this.looseEquals(currentValue, toValue) && !this.looseEquals(previousValue, toValue);
      case 'changed_from':
        return this.looseEquals(previousValue, fromValue) && !this.looseEquals(currentValue, fromValue);
      case 'matches_regex':
        try {
          return new RegExp(String(targetValue)).test(String(currentValue || ''));
        } catch {
          return false;
        }
      default:
        logger.warn(`Unknown condition operator: ${operator}`);
        return false;
    }
  }

  private looseEquals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a == null && b == null) return true;
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  // ---- OQL Conditions ----

  private async evaluateOql(condition: OqlCondition, ctx: ExecutionContext): Promise<boolean> {
    const resolvedQuery = await this.templateResolver.resolveString(condition.query, ctx);

    try {
      const result = await this.onstaqClient.executeOql(resolvedQuery, ctx.workspaceId);

      if (condition.expectCount !== undefined) {
        return result.totalCount === condition.expectCount;
      }

      return result.totalCount > 0;
    } catch (err: any) {
      logger.error(`OQL condition evaluation failed: ${err.message}`);
      return false;
    }
  }

  // ---- Reference Conditions ----

  private async evaluateReference(condition: ReferenceCondition, ctx: ExecutionContext): Promise<boolean> {
    const item = ctx.trigger.item;
    if (!item) return false;

    try {
      const refs = await this.onstaqClient.getReferences(item.id);
      const relevantRefs = condition.direction === 'outbound' ? refs.outbound : refs.inbound;

      let filtered = relevantRefs;

      if (condition.referenceKind) {
        filtered = filtered.filter((r) => r.referenceKind === condition.referenceKind);
      }

      // TODO: Filter by catalogName if provided (requires fetching target items)

      return condition.exists ? filtered.length > 0 : filtered.length === 0;
    } catch (err: any) {
      logger.error(`Reference condition evaluation failed: ${err.message}`);
      return false;
    }
  }

  // ---- Template Conditions ----

  private async evaluateTemplate(condition: TemplateCondition, ctx: ExecutionContext): Promise<boolean> {
    const resolved = await this.templateResolver.resolveString(condition.expression, ctx);
    // Truthy evaluation: non-empty, non-zero, non-"false"
    if (!resolved || resolved === 'false' || resolved === '0' || resolved === 'null' || resolved === 'undefined') {
      return false;
    }
    return true;
  }

  // ---- Type Guard ----

  private isConditionGroup(node: ConditionConfig): node is ConditionGroup {
    return 'operator' in node && 'conditions' in node && Array.isArray((node as any).conditions);
  }
}

// =============================================================================
// Function Registry
// Central registry for all smart value functions
// =============================================================================

import { SmartValueFunction } from '../smart-value-types';
import { registerStringFunctions } from './string-functions';
import { registerDateFunctions } from './date-functions';
import { registerNumberFunctions } from './number-functions';
import { registerCollectionFunctions } from './collection-functions';

export class FunctionRegistry {
  private functions: Map<string, SmartValueFunction> = new Map();

  register(fn: SmartValueFunction): void {
    this.functions.set(fn.name, fn);
  }

  get(name: string): SmartValueFunction | undefined {
    return this.functions.get(name);
  }

  has(name: string): boolean {
    return this.functions.has(name);
  }

  list(): string[] {
    return [...this.functions.keys()];
  }
}

/**
 * Create a registry with all built-in smart value functions.
 */
export function createDefaultRegistry(): FunctionRegistry {
  const registry = new FunctionRegistry();
  registerStringFunctions(registry);
  registerDateFunctions(registry);
  registerNumberFunctions(registry);
  registerCollectionFunctions(registry);
  return registry;
}

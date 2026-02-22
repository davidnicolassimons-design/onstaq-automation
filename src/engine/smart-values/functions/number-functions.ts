// =============================================================================
// Number Functions
// Smart value functions for numeric operations
// =============================================================================

import { FunctionRegistry } from './index';

export function registerNumberFunctions(registry: FunctionRegistry): void {
  registry.register({
    name: 'toNumber',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['any'],
    execute: (value) => {
      const n = Number(value);
      if (isNaN(n)) throw new Error(`Cannot convert "${value}" to number`);
      return n;
    },
  });

  registry.register({
    name: 'abs',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Math.abs(Number(value)),
  });

  registry.register({
    name: 'round',
    minArgs: 0,
    maxArgs: 1,
    appliesTo: ['number'],
    execute: (value, args) => {
      const decimals = args[0] != null ? Number(args[0]) : 0;
      const factor = Math.pow(10, decimals);
      return Math.round(Number(value) * factor) / factor;
    },
  });

  registry.register({
    name: 'ceil',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Math.ceil(Number(value)),
  });

  registry.register({
    name: 'floor',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Math.floor(Number(value)),
  });

  registry.register({
    name: 'min',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['number'],
    execute: (value, args) => Math.min(Number(value), Number(args[0])),
  });

  registry.register({
    name: 'max',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['number'],
    execute: (value, args) => Math.max(Number(value), Number(args[0])),
  });

  registry.register({
    name: 'percentage',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['number'],
    execute: (value, args) => {
      const total = Number(args[0]);
      if (total === 0) return 0;
      return (Number(value) / total) * 100;
    },
  });

  registry.register({
    name: 'isPositive',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Number(value) > 0,
  });

  registry.register({
    name: 'isNegative',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Number(value) < 0,
  });

  registry.register({
    name: 'isZero',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['number'],
    execute: (value) => Number(value) === 0,
  });
}

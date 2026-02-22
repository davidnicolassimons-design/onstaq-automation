// =============================================================================
// Collection Functions
// Smart value functions for array/collection operations
// =============================================================================

import { FunctionRegistry } from './index';

export function registerCollectionFunctions(registry: FunctionRegistry): void {
  registry.register({
    name: 'size',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array', 'string'],
    execute: (value) => {
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'string') return value.length;
      return 0;
    },
  });

  registry.register({
    name: 'first',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (Array.isArray(value) && value.length > 0) return value[0];
      return null;
    },
  });

  registry.register({
    name: 'last',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (Array.isArray(value) && value.length > 0) return value[value.length - 1];
      return null;
    },
  });

  registry.register({
    name: 'join',
    minArgs: 0,
    maxArgs: 1,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value)) return String(value);
      const delimiter = args[0] != null ? String(args[0]) : ', ';
      return value.map(String).join(delimiter);
    },
  });

  registry.register({
    name: 'contains',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['array', 'string'],
    execute: (value, args) => {
      if (Array.isArray(value)) return value.includes(args[0]);
      if (typeof value === 'string') return value.includes(String(args[0]));
      return false;
    },
  });

  // isEmpty and isNotEmpty are registered in string-functions (they handle both)

  registry.register({
    name: 'flatten',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (!Array.isArray(value)) return [value];
      return value.flat();
    },
  });

  registry.register({
    name: 'unique',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (!Array.isArray(value)) return [value];
      return [...new Set(value)];
    },
  });

  registry.register({
    name: 'sort',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (!Array.isArray(value)) return [value];
      return [...value].sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
      });
    },
  });

  registry.register({
    name: 'reverse',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (!Array.isArray(value)) return [value];
      return [...value].reverse();
    },
  });

  registry.register({
    name: 'at',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value)) return undefined;
      const index = Number(args[0]);
      return value.at(index);
    },
  });

  registry.register({
    name: 'slice',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['array', 'string'],
    execute: (value, args) => {
      const start = Number(args[0]);
      const end = args[1] != null ? Number(args[1]) : undefined;
      if (Array.isArray(value)) return value.slice(start, end);
      if (typeof value === 'string') return value.slice(start, end);
      return value;
    },
  });

  registry.register({
    name: 'map',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value)) return [];
      const path = String(args[0]);
      return value.map((item) => {
        if (item == null) return null;
        // Navigate dot-separated path
        const segments = path.split('.');
        let current: any = item;
        for (const seg of segments) {
          if (current == null) return null;
          // Handle attributeValues alias
          if (seg === 'attributes' && current.attributeValues) {
            current = current.attributeValues;
            continue;
          }
          current = current[seg];
        }
        return current;
      });
    },
  });

  registry.register({
    name: 'filter',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value)) return [];
      const path = String(args[0]);
      const expected = args[1];

      return value.filter((item) => {
        if (item == null) return false;
        const segments = path.split('.');
        let current: any = item;
        for (const seg of segments) {
          if (current == null) return false;
          if (seg === 'attributes' && current.attributeValues) {
            current = current.attributeValues;
            continue;
          }
          current = current[seg];
        }
        // If no expected value provided, check truthiness
        if (expected === undefined) return !!current;
        // eslint-disable-next-line eqeqeq
        return current == expected;
      });
    },
  });

  registry.register({
    name: 'sum',
    minArgs: 0,
    maxArgs: 1,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value)) return 0;
      if (args[0] != null) {
        // Sum by path
        const path = String(args[0]);
        return value.reduce((acc, item) => {
          if (item == null) return acc;
          const segments = path.split('.');
          let current: any = item;
          for (const seg of segments) {
            if (current == null) return acc;
            if (seg === 'attributes' && current.attributeValues) {
              current = current.attributeValues;
              continue;
            }
            current = current[seg];
          }
          return acc + (Number(current) || 0);
        }, 0);
      }
      return value.reduce((acc, v) => acc + (Number(v) || 0), 0);
    },
  });

  registry.register({
    name: 'avg',
    minArgs: 0,
    maxArgs: 1,
    appliesTo: ['array'],
    execute: (value, args) => {
      if (!Array.isArray(value) || value.length === 0) return 0;
      if (args[0] != null) {
        const path = String(args[0]);
        const total = value.reduce((acc, item) => {
          if (item == null) return acc;
          const segments = path.split('.');
          let current: any = item;
          for (const seg of segments) {
            if (current == null) return acc;
            if (seg === 'attributes' && current.attributeValues) {
              current = current.attributeValues;
              continue;
            }
            current = current[seg];
          }
          return acc + (Number(current) || 0);
        }, 0);
        return total / value.length;
      }
      const total = value.reduce((acc, v) => acc + (Number(v) || 0), 0);
      return total / value.length;
    },
  });

  registry.register({
    name: 'count',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['array'],
    execute: (value) => {
      if (Array.isArray(value)) return value.length;
      return 0;
    },
  });
}

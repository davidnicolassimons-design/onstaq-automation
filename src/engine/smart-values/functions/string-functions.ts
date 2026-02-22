// =============================================================================
// String Functions
// Smart value functions for string manipulation
// =============================================================================

import { FunctionRegistry } from './index';

export function registerStringFunctions(registry: FunctionRegistry): void {
  registry.register({
    name: 'toUpperCase',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => String(value).toUpperCase(),
  });

  registry.register({
    name: 'toLowerCase',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => String(value).toLowerCase(),
  });

  registry.register({
    name: 'capitalize',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => {
      const s = String(value);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
  });

  registry.register({
    name: 'truncate',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['string'],
    execute: (value, args) => {
      const s = String(value);
      const max = Number(args[0]);
      const suffix = args[1] != null ? String(args[1]) : '...';
      if (s.length <= max) return s;
      return s.slice(0, max - suffix.length) + suffix;
    },
  });

  registry.register({
    name: 'replace',
    minArgs: 2,
    maxArgs: 2,
    appliesTo: ['string'],
    execute: (value, args) => String(value).replaceAll(String(args[0]), String(args[1])),
  });

  registry.register({
    name: 'match',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['string'],
    execute: (value, args) => {
      const regex = new RegExp(String(args[0]));
      const m = String(value).match(regex);
      return m ? m[0] : null;
    },
  });

  registry.register({
    name: 'substring',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['string'],
    execute: (value, args) => {
      const s = String(value);
      const start = Number(args[0]);
      const end = args[1] != null ? Number(args[1]) : undefined;
      return s.substring(start, end);
    },
  });

  registry.register({
    name: 'trim',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => String(value).trim(),
  });

  registry.register({
    name: 'length',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string', 'array'],
    execute: (value) => {
      if (Array.isArray(value)) return value.length;
      return String(value).length;
    },
  });

  registry.register({
    name: 'split',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['string'],
    execute: (value, args) => String(value).split(String(args[0])),
  });

  registry.register({
    name: 'concat',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['string'],
    execute: (value, args) => String(value) + String(args[0]),
  });

  registry.register({
    name: 'padStart',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['string'],
    execute: (value, args) => {
      const targetLength = Number(args[0]);
      const padChar = args[1] != null ? String(args[1]) : ' ';
      return String(value).padStart(targetLength, padChar);
    },
  });

  registry.register({
    name: 'padEnd',
    minArgs: 1,
    maxArgs: 2,
    appliesTo: ['string'],
    execute: (value, args) => {
      const targetLength = Number(args[0]);
      const padChar = args[1] != null ? String(args[1]) : ' ';
      return String(value).padEnd(targetLength, padChar);
    },
  });

  registry.register({
    name: 'isEmpty',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string', 'array', 'any'],
    execute: (value) => {
      if (value === null || value === undefined) return true;
      if (Array.isArray(value)) return value.length === 0;
      return String(value).length === 0;
    },
  });

  registry.register({
    name: 'isNotEmpty',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string', 'array', 'any'],
    execute: (value) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      return String(value).length > 0;
    },
  });

  registry.register({
    name: 'htmlEncode',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },
  });

  registry.register({
    name: 'urlEncode',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['string'],
    execute: (value) => encodeURIComponent(String(value)),
  });

  registry.register({
    name: 'jsonStringify',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['any'],
    execute: (value) => JSON.stringify(value),
  });
}

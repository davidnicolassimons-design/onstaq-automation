// =============================================================================
// Date Functions
// Smart value functions for date manipulation and formatting
// =============================================================================

import { FunctionRegistry } from './index';
import { formatDate, toDate } from '../date-helpers';

export function registerDateFunctions(registry: FunctionRegistry): void {
  registry.register({
    name: 'plusDays',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      d.setDate(d.getDate() + Number(args[0]));
      return d;
    },
  });

  registry.register({
    name: 'minusDays',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      d.setDate(d.getDate() - Number(args[0]));
      return d;
    },
  });

  registry.register({
    name: 'plusHours',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      d.setHours(d.getHours() + Number(args[0]));
      return d;
    },
  });

  registry.register({
    name: 'minusHours',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      d.setHours(d.getHours() - Number(args[0]));
      return d;
    },
  });

  registry.register({
    name: 'plusMinutes',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      d.setMinutes(d.getMinutes() + Number(args[0]));
      return d;
    },
  });

  registry.register({
    name: 'format',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      return formatDate(d, String(args[0]));
    },
  });

  registry.register({
    name: 'isAfter',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      const other = toDate(args[0]);
      return d.getTime() > other.getTime();
    },
  });

  registry.register({
    name: 'isBefore',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      const other = toDate(args[0]);
      return d.getTime() < other.getTime();
    },
  });

  registry.register({
    name: 'dayOfWeek',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['date', 'string'],
    execute: (value) => {
      const d = toDate(value);
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return days[d.getDay()];
    },
  });

  registry.register({
    name: 'startOfDay',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['date', 'string'],
    execute: (value) => {
      const d = toDate(value);
      d.setHours(0, 0, 0, 0);
      return d;
    },
  });

  registry.register({
    name: 'endOfDay',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['date', 'string'],
    execute: (value) => {
      const d = toDate(value);
      d.setHours(23, 59, 59, 999);
      return d;
    },
  });

  registry.register({
    name: 'toEpochMs',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['date', 'string'],
    execute: (value) => toDate(value).getTime(),
  });

  registry.register({
    name: 'diffDays',
    minArgs: 1,
    maxArgs: 1,
    appliesTo: ['date', 'string'],
    execute: (value, args) => {
      const d = toDate(value);
      const other = toDate(args[0]);
      const diffMs = d.getTime() - other.getTime();
      return Math.round(diffMs / (1000 * 60 * 60 * 24));
    },
  });

  // Static function: now() — returns current date
  registry.register({
    name: 'now',
    minArgs: 0,
    maxArgs: 0,
    appliesTo: ['any'],
    execute: () => new Date(),
  });
}

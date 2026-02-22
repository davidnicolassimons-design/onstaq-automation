// =============================================================================
// Date Helpers
// Native Date formatting and coercion utilities (no external dependencies)
// =============================================================================

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Format a Date using pattern tokens.
 * Supported: yyyy, yy, MM, M, dd, d, HH, H, mm, m, ss, s, SSS, EEEE, EEE
 */
export function formatDate(date: Date, pattern: string): string {
  const tokens: Record<string, () => string> = {
    'yyyy': () => String(date.getFullYear()),
    'yy': () => String(date.getFullYear()).slice(-2),
    'MM': () => String(date.getMonth() + 1).padStart(2, '0'),
    'M': () => String(date.getMonth() + 1),
    'dd': () => String(date.getDate()).padStart(2, '0'),
    'd': () => String(date.getDate()),
    'HH': () => String(date.getHours()).padStart(2, '0'),
    'H': () => String(date.getHours()),
    'mm': () => String(date.getMinutes()).padStart(2, '0'),
    'm': () => String(date.getMinutes()),
    'ss': () => String(date.getSeconds()).padStart(2, '0'),
    's': () => String(date.getSeconds()),
    'SSS': () => String(date.getMilliseconds()).padStart(3, '0'),
    'EEEE': () => DAY_NAMES[date.getDay()],
    'EEE': () => DAY_SHORT[date.getDay()],
  };

  // Replace longest tokens first to avoid partial matches (e.g. 'MM' before 'M')
  let result = pattern;
  const sortedKeys = Object.keys(tokens).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    result = result.replaceAll(key, tokens[key]());
  }
  return result;
}

/**
 * Coerce a value to a Date object.
 */
export function toDate(value: any): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const d = new Date(value);
    if (isNaN(d.getTime())) throw new Error(`Cannot parse "${value}" as a date`);
    return d;
  }
  throw new Error(`Cannot convert ${typeof value} to Date`);
}

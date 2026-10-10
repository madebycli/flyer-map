/**
 * Nothing that identifies a person, a place or a session may enter a log or a report: positions stay on the device (AGENTS.md),
 * links and cookies are credentials. Redaction is structural (by key) and textual (token-like strings), applied when an entry is recorded
 * and once more when a report is built.
 */
const SECRET_KEY = /^(lat|lng|lon|latitude|longitude|coords?|coordinates|center|centre|position|geometry|ring|bbox|bounds|token|secret|password|passwd|cookie|authorization|auth|session|hash|access|label|name|address|title|text|body|email|note|notes)$/i;
const TOKEN_LIKE = /[A-Za-z0-9_-]{32,}/g;
const FRAGMENT = /#(access|collection)=\S+/gi;
const MAX_TEXT = 300;
const MAX_ITEMS = 20;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;
/** Entries are small and bounded; a report is ours to size (every metric name, the whole log tail). */
export type Limits = { items: number; keys: number };
const ENTRY_LIMITS: Limits = { items: MAX_ITEMS, keys: MAX_KEYS };
export const REPORT_LIMITS: Limits = { items: 1000, keys: 600 };

export function redactText(text: string, max = MAX_TEXT): string {
  const clean = text.replace(FRAGMENT, '#$1=[removed]').replace(TOKEN_LIKE, '[token]');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function redactValue(value: unknown, depth = 0, lim: Limits = ENTRY_LIMITS): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText((value.stack ?? '').split('\n').slice(0, 4).join(' | '), 500) };
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const items = Array.isArray(value) ? value : Array.from(value as unknown as ArrayLike<unknown>).slice(0, lim.items + 1);
    const out = items.slice(0, lim.items).map((item) => redactValue(item, depth + 1, lim));
    if (items.length > lim.items) out.push(`…+${(Array.isArray(value) ? value.length : (value as ArrayBufferView).byteLength) - lim.items}`);
    return out;
  }
  if (value instanceof Map) return redactValue(Object.fromEntries(value), depth, lim);
  if (value instanceof Set) return redactValue([...value], depth, lim);
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (n++ >= lim.keys) { out['…'] = 'more keys'; break; }
    out[key] = SECRET_KEY.test(key) ? '[removed]' : redactValue(item, depth + 1, lim);
  }
  return out;
}

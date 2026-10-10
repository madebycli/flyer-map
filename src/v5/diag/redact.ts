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

const URL_LIKE = /\b(?:https?|wss?|blob|data):[^\s"'<>)]*/gi;
const COORDINATE = /-?\d{1,3}\.\d{4,}/g;
const LONG_DIGITS = /\d{6,}/g;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/**
 * Defence in depth for every string that is recorded: web addresses, coordinates, long numbers, e-mail addresses and token-like strings never survive,
 * wherever they appear. This does *not* make arbitrary foreign text safe (a name or a note has no recognisable shape): that is `foreignMessage`'s job.
 */
export function redactText(text: string, max = MAX_TEXT): string {
  const clean = text.replace(FRAGMENT, '#$1=[removed]').replace(URL_LIKE, '[url]').replace(EMAIL, '[email]').replace(COORDINATE, '[num]').replace(LONG_DIGITS, '[num]').replace(TOKEN_LIKE, '[token]');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * Text that comes from outside our own code (an exception message, a library's console line, a server's error text) can hold anything: a name, a note,
 * a key in an address. It is therefore never kept, only *recognised*: when it starts like a message we know to be technical, that start is kept;
 * otherwise only its length is recorded. Extend the list when a real, harmless message is missed in the field; never loosen it to "keep most text".
 */
const KNOWN_MESSAGES: RegExp[] = [
  /^Failed to fetch\b/, /^Load failed\b/, /^NetworkError\b/, /^The operation (?:was aborted|timed out)\b/, /^signal is aborted\b/i, /^(?:Request )?timed out\b/i, /^AbortError\b/,
  /^The sourceLayer parameter must be provided for vector source types/, /^Out of memory\b/i, /^QuotaExceededError\b/, /^The quota has been exceeded\b/i,
  /^(?:Could not create a WebGL context|Failed to initialize WebGL|WebGL context lost)\b/i, /^Script error\.?$/, /^ResizeObserver loop (?:limit exceeded|completed with undelivered notifications)\b/,
  /^Cannot read propert(?:y|ies) of (?:undefined|null)\b/, /^Worker failed to load\b/, /^HTTP \d{3}\b/, /^status \d{3}\b/, /^Unexpected end of (?:JSON )?input\b/i,
  /^(?:Der Server antwortet nicht|Keine Verbindung|offline)\b/,
];
export function foreignMessage(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : value instanceof Error ? value.message.trim() : '';
  if (!text) return '';
  for (const known of KNOWN_MESSAGES) { const hit = known.exec(text); if (hit) return redactText(hit[0], 80); }
  return `[text removed, ${text.length} chars]`;
}

/** Keys whose values are free text from outside: exception messages, rejection reasons, a server's error line. */
const FOREIGN_KEY = /^(message|error|reason|lastError|cause|detail|description|err)$/i;
const ERROR_NAME = /^[A-Za-z]{2,40}(?:Error|Exception)$|^Error$/;
const basename = (path: string) => path.split(/[?#]/)[0].split('/').pop() ?? '';

/** An address reduced to what it is, not where it points: the kind of resource, never a path, tile number or query. */
export function urlKind(url: string): string {
  const path = (() => { try { return new URL(url, 'http://local').pathname; } catch { return url; } })();
  if (/\/\d+\/\d+\/\d+(?:\.\w+)?$/.test(path)) return 'tile';
  if (/glyph|\.pbf$|fonts?\//i.test(path)) return 'glyphs';
  if (/sprite/i.test(path)) return 'sprite';
  if (/style|\.json$/i.test(path)) return 'style';
  if (/^\/api\//.test(path)) return 'api';
  return 'other';
}

/** The stack of an error, reduced to function names and `file:line:col`, four lines at most. */
function safeStack(stack: string | undefined): string {
  if (!stack) return '';
  return stack.split('\n').slice(1, 5).map((line) => {
    const m = /^\s*at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line) ?? /^\s*(.*?)@(.*?):(\d+):(\d+)\s*$/.exec(line);
    return m ? `${(m[1] ?? '').replace(/[^\w.$<> ]/g, '').slice(0, 40)} ${basename(m[2])}:${m[3]}:${m[4]}`.trim() : '?';
  }).join(' | ');
}

/** One object member: secret keys vanish, free-text keys go through the allowlist, a `stack` is reduced, everything else is walked. */
function redactField(key: string, item: unknown, depth: number, lim: Limits): unknown {
  if (SECRET_KEY.test(key)) return '[removed]';
  if (FOREIGN_KEY.test(key) && (typeof item === 'string' || item instanceof Error)) return item instanceof Error ? redactValue(item, depth + 1, lim) : foreignMessage(item);
  if (key === 'stack' && typeof item === 'string') return safeStack(`\n${item}`);
  return redactValue(item, depth + 1, lim);
}

/** `file.js:12:3` of an error event: the bundled file's name only, never its address. */
export const whereOf = (filename: string | undefined, line?: number, col?: number) => `${basename(filename ?? '') || '?'}:${line ?? 0}:${col ?? 0}`;

export function redactValue(value: unknown, depth = 0, lim: Limits = ENTRY_LIMITS): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (value instanceof Error) return { name: ERROR_NAME.test(value.name) ? value.name : 'Error', message: foreignMessage(value), stack: safeStack(value.stack) };
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
    out[key] = redactField(key, item, depth, lim);
  }
  return out;
}

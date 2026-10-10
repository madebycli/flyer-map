import { CATEGORIES, LEVELS, type Category, type Entry, type Level } from './log.ts';
import { redactText, redactValue } from './redact.ts';

const TAIL_KEY = 'vf-v5-diag-tail';
const BOOTS_KEY = 'vf-v5-diag-boots';
const FLAG_KEY = 'vf-v5-diag';
const KEEP = 80;

/** What the previous page session ended with (warnings and errors only; read back through the current redaction, an older version's tail is never trusted): the first thing to read after a crash or a forced reload. */
export type PreviousSession = { session: string; endedAt: number; entries: Entry[] };

/** Tails written before the allowlist (format 1) could hold foreign text in `msg`; they are dropped, not cleaned. */
const TAIL_FORMAT = 2;
/** In these categories a message used to be foreign text; now only our own fixed messages are written there, and only those are read back. */
const FIXED_MESSAGES: Partial<Record<string, ReadonlySet<string>>> = {
  error: new Set(['uncaught error', 'unhandled rejection']),
  console: new Set(['console.warn', 'console.error']),
};

/** One saved entry read back through today's rules: an entry is never trusted for being ours. */
function cleanEntry(e: Entry): Entry {
  const lvl: Level = LEVELS.includes(e.lvl) ? e.lvl : 'warn';
  const cat: Category = CATEGORIES.includes(e.cat) ? e.cat : 'error';
  const fixed = FIXED_MESSAGES[cat];
  const msg = fixed && !fixed.has(String(e.msg)) ? `${cat} (text removed)` : redactText(String(e.msg), 200);
  return { seq: Number(e.seq) || 0, t: Number(e.t) || 0, at: Number(e.at) || 0, lvl, cat, msg, ...(e.data === undefined ? {} : { data: redactValue(e.data) }) };
}

export function loadPrevious(): PreviousSession | null {
  try {
    const raw = localStorage.getItem(TAIL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreviousSession & { v?: number };
    if (!parsed || parsed.v !== TAIL_FORMAT || !Array.isArray(parsed.entries)) { localStorage.removeItem(TAIL_KEY); return null; }
    const entries = parsed.entries.map(cleanEntry);
    // What is shown is what stays on the device: the cleaned tail replaces the stored one.
    localStorage.setItem(TAIL_KEY, JSON.stringify({ v: TAIL_FORMAT, session: String(parsed.session), endedAt: Number(parsed.endedAt) || 0, entries }));
    return { session: String(parsed.session), endedAt: Number(parsed.endedAt) || 0, entries: entries.map((e) => ({ ...e, prev: true as const })) };
  } catch { try { localStorage.removeItem(TAIL_KEY); } catch { /* ignore */ } return null; }
}

export function bumpBootCount(): number {
  try { const n = (Number(localStorage.getItem(BOOTS_KEY)) || 0) + 1; localStorage.setItem(BOOTS_KEY, String(n)); return n; } catch { return 1; }
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Debounced: a burst of warnings is written once. Failure (private mode, quota) is silent: a log must never break the app. */
export function saveTail(session: string, entries: Entry[]) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try { localStorage.setItem(TAIL_KEY, JSON.stringify({ v: TAIL_FORMAT, session, endedAt: Date.now(), entries: entries.slice(-KEEP).map(({ prev: _prev, ...e }) => e) })); } catch { /* ignore */ }
  }, 800);
}

export const diagFlag = {
  read(): boolean { try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; } },
  write(on: boolean) { try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ } },
};

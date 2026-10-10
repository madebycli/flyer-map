import type { Entry } from './log.ts';

const TAIL_KEY = 'vf-v5-diag-tail';
const BOOTS_KEY = 'vf-v5-diag-boots';
const FLAG_KEY = 'vf-v5-diag';
const KEEP = 80;

/** What the previous page session ended with (warnings and errors only): the first thing to read after a crash or a forced reload. */
export type PreviousSession = { session: string; endedAt: number; entries: Entry[] };

export function loadPrevious(): PreviousSession | null {
  try {
    const raw = localStorage.getItem(TAIL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreviousSession;
    return parsed && Array.isArray(parsed.entries) ? { ...parsed, entries: parsed.entries.map((e) => ({ ...e, prev: true as const })) } : null;
  } catch { return null; }
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
    try { localStorage.setItem(TAIL_KEY, JSON.stringify({ session, endedAt: Date.now(), entries: entries.slice(-KEEP).map(({ prev: _prev, ...e }) => e) })); } catch { /* ignore */ }
  }, 800);
}

export const diagFlag = {
  read(): boolean { try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; } },
  write(on: boolean) { try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch { /* ignore */ } },
};

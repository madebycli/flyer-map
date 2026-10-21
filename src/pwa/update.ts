import { APP, fetchLatest, isNewer, type Latest } from './version.ts';

/**
 * Keeping every device on the current build without anybody knowing there is an update.
 * - A start with a newer build online reloads once before the app is shown (`coldStartUpdate`).
 * - A running app is told by `watchUpdates`: on return to the foreground and every few minutes; a return after a long pause counts as a start.
 * - Never a loop: one reload per online build and browser session, whatever the server says.
 */
const TRIED_KEY = 'vf-update-tried';
export const LONG_AWAY_MS = 30 * 60_000;
export const CHECK_EVERY_MS = 10 * 60_000;

export type UpdateDeps = {
  fetchLatest(timeoutMs?: number): Promise<Latest | null>;
  reload(): void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  current: Latest;
};
const realDeps = (): UpdateDeps => ({
  fetchLatest: (timeoutMs) => fetchLatest(timeoutMs),
  reload: () => location.reload(),
  storage: (() => { try { return sessionStorage; } catch { return null; } })(),
  current: APP,
});

/** Reloads once for this online build; false when it already tried (the banner offers it then) or cannot remember that it did. */
export function reloadOnce(latest: Latest, deps: UpdateDeps = realDeps()): boolean {
  if (!deps.storage) return false;
  try {
    if (deps.storage.getItem(TRIED_KEY) === latest.build) return false;
    deps.storage.setItem(TRIED_KEY, latest.build);
  } catch { return false; } // without storage a loop could not be stopped
  deps.reload();
  return true;
}

/**
 * At a start: asks what is online, in parallel with the start (the app never waits for it). Reloads once if a newer build is online
 * and the start screen is still up (`stillStarting`); a person who is already looking at the map gets the banner instead. True when it reloads.
 */
export async function coldStartUpdate(waitMs = 4000, deps: UpdateDeps = realDeps(), stillStarting: () => boolean = () => true): Promise<boolean> {
  const latest = await deps.fetchLatest(waitMs);
  return !!latest && isNewer(latest, deps.current) && stillStarting() && reloadOnce(latest, deps);
}

// ── the running app ─────────────────────────────────────────────
type Listener = (latest: Latest | null) => void;
let available: Latest | null = null;
const listeners = new Set<Listener>();
const publish = (latest: Latest | null) => { available = latest; for (const l of listeners) l(latest); };

export const updateAvailable = () => available;
export function onUpdate(listener: Listener): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** The person taps "update": reload now (this is a choice, so the once-per-build guard does not apply). */
export function applyUpdate(reload: () => void = () => location.reload()) { reload(); }

export type Watch = { check(): Promise<void>; stop(): void };
export function watchUpdates(deps: UpdateDeps = realDeps(), doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'hidden'> = document, now: () => number = Date.now): Watch {
  let hiddenAt: number | null = doc.hidden ? now() : null;
  const check = async () => {
    const latest = await deps.fetchLatest(4000);
    if (latest && isNewer(latest, deps.current)) publish(latest); else if (available && latest) publish(null);
  };
  const onVisibility = () => {
    if (doc.hidden) { hiddenAt = now(); return; }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    void (async () => {
      await check();
      // away for a long time = a start: nothing is being done, so the new build goes in without asking
      if (away >= LONG_AWAY_MS && available) reloadOnce(available, deps);
    })();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(() => { if (!doc.hidden) void check(); }, CHECK_EVERY_MS);
  void check();
  return { check, stop: () => { doc.removeEventListener('visibilitychange', onVisibility); clearInterval(timer); } };
}

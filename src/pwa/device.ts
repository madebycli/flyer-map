/**
 * Two small things that make the app behave like a field tool on a phone: the screen stays on while you work, and a short buzz confirms a mark.
 * Both are device settings (kept in localStorage, on by default) and both fail quietly where the browser has no such thing (iOS has no vibration).
 */
const KEYS = { awake: 'vf-awake', haptics: 'vf-haptics' } as const;
const read = (key: string): boolean => { try { return localStorage.getItem(key) !== 'off'; } catch { return true; } };
const write = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ } };

export const readAwake = () => read(KEYS.awake);
export const saveAwake = (on: boolean) => write(KEYS.awake, on);
export const readHaptics = () => read(KEYS.haptics);
export const saveHaptics = (on: boolean) => write(KEYS.haptics, on);

/** A short buzz for a mark that went through. */
export function tick(nav: Pick<Navigator, 'vibrate'> | undefined = typeof navigator === 'undefined' ? undefined : navigator): void {
  if (!readHaptics()) return;
  try { nav?.vibrate?.(12); } catch { /* not allowed or not there */ }
}

type Lock = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void };
type WakeNav = { wakeLock?: { request(type: 'screen'): Promise<Lock> } };

/** Keep the screen on while the page is visible; the browser drops the lock when the tab hides, so it is asked for again when it shows. Returns the stop function. */
export function keepAwake(nav: WakeNav = (typeof navigator === 'undefined' ? {} : navigator) as WakeNav, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document): () => void {
  if (!nav.wakeLock) return () => {};
  let lock: Lock | null = null, stopped = false;
  const ask = () => {
    if (stopped || lock || doc.visibilityState !== 'visible') return;
    nav.wakeLock!.request('screen').then((l) => { if (stopped) { void l.release(); return; } lock = l; l.addEventListener('release', () => { if (lock === l) lock = null; }); }, () => {});
  };
  doc.addEventListener('visibilitychange', ask);
  ask();
  return () => { stopped = true; doc.removeEventListener('visibilitychange', ask); void lock?.release().catch(() => {}); lock = null; };
}

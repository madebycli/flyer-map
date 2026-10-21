/** Is this a phone or tablet in a normal browser tab (so the guide to install the app makes sense)? */
export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios'; // iPadOS asks for the desktop site by default
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
}

type Win = { matchMedia?: (query: string) => { matches: boolean }; navigator?: object };
export function isStandalone(win: Win = window): boolean {
  try {
    if ((win.navigator as { standalone?: boolean } | undefined)?.standalone === true) return true;
    return ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => win.matchMedia?.(`(display-mode: ${mode})`).matches);
  } catch { return false; }
}

const SKIP_KEY = 'vf-install-skip';
const SKIP_DAYS = 7;

export function guideWanted(input: { platform: Platform; standalone: boolean; skippedUntil: number; now: number; automation: boolean }): boolean {
  return input.platform !== 'other' && !input.standalone && !input.automation && input.now >= input.skippedUntil;
}

export function readSkip(storage: Pick<Storage, 'getItem'> | null = safeStorage()): number {
  try { const n = Number(storage?.getItem(SKIP_KEY)); return Number.isFinite(n) ? n : 0; } catch { return 0; }
}
export function saveSkip(now = Date.now(), storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try { storage?.setItem(SKIP_KEY, String(now + SKIP_DAYS * 86_400_000)); } catch { /* private mode: the guide shows again next time */ }
}
function safeStorage(): Storage | null { try { return localStorage; } catch { return null; } }

/** The guide, right now, for this device. Never in automated browsers (tests) and never in the installed app. */
export function wantsGuide(): boolean {
  return guideWanted({ platform: detectPlatform(navigator.userAgent, navigator.maxTouchPoints), standalone: isStandalone(), skippedUntil: readSkip(), now: Date.now(), automation: navigator.webdriver === true });
}

// Android/Chrome offers the real install dialog through an event that has to be kept until the person taps the button.
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferred: InstallEvent | null = null;
const waiting = new Set<() => void>();
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferred = event as InstallEvent; for (const w of waiting) w(); });
  window.addEventListener('appinstalled', () => { deferred = null; for (const w of waiting) w(); });
}
export const canPromptInstall = () => deferred !== null;
export function onInstallPromptChange(fn: () => void): () => void { waiting.add(fn); return () => { waiting.delete(fn); }; }
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

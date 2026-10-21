/**
 * The start screen is plain HTML in the page (logo, one line, a thin bar), so it is there before any script. The app only tells it what is
 * being loaded and takes it away once everything is ready: nothing may pop in underneath.
 */
const STUCK_AFTER_MS = 25_000;
let done = false;
let stuckTimer: ReturnType<typeof setTimeout> | undefined;

const element = () => (typeof document === 'undefined' ? null : document.getElementById('splash'));

export const splash = {
  /** What is loading right now (short, German). */
  text(text: string): void {
    const node = typeof document === 'undefined' ? null : document.getElementById('splash-text');
    if (node && !done && node.textContent !== text) node.textContent = text;
  },
  /** Fades the screen out and removes it. Safe to call again. */
  hide(): void {
    const el = element();
    if (done || !el) return;
    done = true;
    clearTimeout(stuckTimer);
    el.classList.add('done');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => el.remove(), reduced ? 0 : 280);
  },
  /** Starts the watchdog: a start that never finishes offers a reload instead of a screen that stays forever. */
  watch(afterMs = STUCK_AFTER_MS): void {
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      const el = element();
      if (done || !el || el.querySelector('.splash-retry')) return;
      splash.text('Das dauert länger als gewöhnlich.');
      const button = document.createElement('button');
      button.className = 'splash-retry';
      button.textContent = 'Neu laden';
      button.onclick = () => location.reload();
      el.appendChild(button);
    }, afterMs);
  },
  /** True while the start screen is still in the page (so a later loading phase must draw its own). */
  active(): boolean { return !done && !!element(); },
  /** Test hook. */
  reset(): void { done = false; clearTimeout(stuckTimer); },
};

import { APP } from './version.ts';

/**
 * The service worker of the app shell (public/sw.js, ADR-0038). Registered per build (`?v=`), so each deploy installs its own copy.
 * Not in a development build and not in an automated browser, unless a test asks for it with `localStorage['vf-sw'] = 'on'`.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (APP.version === 'dev') return;
  let forced = false;
  try { forced = localStorage.getItem('vf-sw') === 'on'; } catch { /* private mode */ }
  if (navigator.webdriver && !forced) return;
  const start = () => { void navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(APP.build)}`, { scope: '/' }).catch(() => { /* no service worker: the app works as a website */ }); };
  if (document.readyState === 'complete') start(); else window.addEventListener('load', start, { once: true });
}

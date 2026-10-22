// Shared pieces of the browser flows of the Rust app (headless Chromium via playwright-core; never a real device).
//   CHROMIUM_PATH (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome), PLAYWRIGHT_CORE (module path), SHOTS_DIR (screenshots;
//   default <tmp>/flyermap-rs-e2e, never the repository).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.js');
export const { chromium } = pw.default ?? pw;

export const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'flyermap-rs-e2e');
mkdirSync(shots, { recursive: true });

export const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--no-proxy-server'] });

/** `check(name, ok, detail)` prints one line; `failures()` is the count. */
export function reporter() {
  let failed = 0;
  return {
    check(name, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
      if (!ok) failed++;
      return ok;
    },
    failures: () => failed,
  };
}

/** The two phones and the desktop of the flows, in both themes. */
export const VIEWS = [
  { width: 390, height: 844, theme: 'dark' },
  { width: 390, height: 844, theme: 'light' },
  { width: 1280, height: 800, theme: 'dark' },
  { width: 1280, height: 800, theme: 'light' },
];

/** A page in a fresh context with the theme chosen, console problems collected (the flows demand a quiet console). */
export async function openPage(browser, { width, height, theme }, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: width < 600, isMobile: width < 600, ...extra });
  if (theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()} ${m.text()}`); });
  return { context, page, problems };
}

export const rectOf = (page, selector) => page.locator(selector).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
export const settle = (page, selector) => page.locator(selector).first().evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });

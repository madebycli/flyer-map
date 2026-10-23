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

export const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

/** Messages of the software GL of headless Chromium (a performance hint about ReadPixels), not of the app; everything else counts. */
export const GL_NOISE = /GL Driver Message|GPU stall due to ReadPixels/;

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
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !GL_NOISE.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  return { context, page, problems };
}

/** The address with the debug hook (`window.__rsMap`, `window.__rsDebug()`), and the map ready: its layers are on and tiles were asked for. */
export const withDebug = (base, query = '') => `${base}?debug${query ? `&${query}` : ''}`;
export const mapReady = (page) => page.waitForFunction(() => window.__rsMap?.isStyleLoaded?.() && window.__rsDebug?.().layers >= 17, null, { timeout: 30000 });
/** The map's counters: tiles held per source and what the tile protocol handed out. */
export const counters = (page) => page.evaluate(() => window.__rsDebug());
/** Wait until the tile protocol has handed out `n` tiles with content. */
export const tilesDrawn = (page, n = 1) => page.waitForFunction((want) => { const p = window.__rsDebug?.().protocol; return p && p.tiles - p.empty >= want; }, n, { timeout: 30000 });
/** A map point as page pixels (the map fills the stage, which starts at the stage's x). */
export const screenOf = (page, lng, lat) => page.evaluate(([lo, la]) => { const p = window.__rsMap.project([lo, la]); const r = document.querySelector('[data-fm-map]').getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; }, [lng, lat]);
/** Features of a layer on the screen, as page pixels, inside a band the overlays leave free: `[{id, pts: [{x, y}, ...]}]` (a polygon's corners, a line's points). */
export const screenFeatures = (page, layer, band) => page.evaluate(([layerId, b]) => {
  const m = window.__rsMap;
  const origin = document.querySelector('[data-fm-map]').getBoundingClientRect();
  const seen = new Set();
  const out = [];
  for (const f of m.queryRenderedFeatures({ layers: [layerId] })) {
    const id = String(f.id ?? f.properties?.key);
    if (seen.has(id)) continue;
    seen.add(id);
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.type === 'LineString' ? f.geometry.coordinates : null;
    if (!ring) continue;
    const pts = ring.map((c) => { const p = m.project(c); return { x: origin.x + p.x, y: origin.y + p.y }; });
    // the status as drawn: what a marking painted (feature state), else what the tile was cut with
    const state = f.state?.status ?? ({ c: 'completed', l: 'later', n: 'not-deliverable' }[String(f.properties?.st)] ?? 'open');
    if (pts.every((p) => p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1)) out.push({ id, pts, state });
  }
  return out;
}, [layer, band]);
/** The middle of a feature's points. */
export const middleOf = (f) => ({ x: f.pts.reduce((s, p) => s + p.x, 0) / f.pts.length, y: f.pts.reduce((s, p) => s + p.y, 0) / f.pts.length });
/** A finger on a touch screen, through the browser's own input path (what the finger tools see): rest, then move along `points`, then lift. */
export async function touchStroke(page, points, { holdMs = 260, stepMs = 16 } = {}) {
  const client = await page.context().newCDPSession(page);
  const touch = (type, p) => client.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
  await touch('touchStart', points[0]);
  await new Promise((r) => setTimeout(r, holdMs));
  for (const p of points.slice(1)) { await touch('touchMove', p); await new Promise((r) => setTimeout(r, stepMs)); }
  await touch('touchEnd');
  await client.detach();
}
export const view =(page) => page.evaluate(() => { const m = window.__rsMap; const c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom() }; });

export const rectOf =(page, selector) => page.locator(selector).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
export const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
export const settle = (page, selector) => page.locator(selector).first().evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });

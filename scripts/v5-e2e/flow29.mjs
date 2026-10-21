// App shell: first paint is dark with the start screen in the HTML, nothing pops in while it covers the page, the version shows in the menu,
// a newer build online is picked up at the start (once) and announced by a banner while running, the undo bar follows the theme, no zoom anywhere.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { setMode, startMarking } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const URL_V5 = `${BASE}/v5.html?campaign=campaign_n&debug`;
// the colour the page shows may be the device's Material You surface (a hair off #0f1514); what matters is that it is dark
const isDark = (css) => { const [r, g, b] = css.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.1; };
const real = await (await fetch(`${BASE}/version.json`)).json();

async function open(context, url = URL_V5) {
  const page = await context.newPage();
  page.on('pageerror', (error) => check(`page error ${error.message}`, false));
  await page.goto(url, { waitUntil: 'commit' });
  return page;
}
const newContext = async (extra = {}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...extra });
  await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
  return context;
};
const awaitReady = async (page) => {
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 180000 });
};

// ── 1. first paint, start screen, nothing pops in underneath ─────────────
{
  const context = await newContext();
  // record every loading card/page/loader that appears while the start screen is still on (the page for missing map data or an error is meant to replace it)
  await context.addInitScript(() => {
    window.__popins = [];
    new MutationObserver((records) => {
      const splash = document.getElementById('splash');
      if (!splash || splash.classList.contains('done')) return; // fading out already: the page that follows is meant to be seen
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && (n.matches?.('.v5-loadingpage, .v5-loader') || n.querySelector?.('.v5-loadingpage, .v5-loader'))) window.__popins.push(n.className);
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await open(context);
  await page.waitForSelector('#splash', { state: 'attached', timeout: 5000 });
  const first = await page.evaluate(() => ({ bg: getComputedStyle(document.documentElement).backgroundColor, splash: !!document.getElementById('splash'), logo: !!document.querySelector('#splash img[src="/icon.svg"]'), text: document.getElementById('splash-text')?.textContent }));
  check('the first paint is dark (no white flash)', isDark(first.bg), first.bg);
  check('the start screen is in the page with the logo and a line of text', first.splash && first.logo && !!first.text, JSON.stringify(first));
  await awaitReady(page);
  const gone = await until(async () => !(await page.evaluate(() => !!document.getElementById('splash'))), 15000);
  check('the start screen goes away once the map is ready', gone);
  const popins = await page.evaluate(() => window.__popins);
  check('no loading card or loader appeared under the start screen', popins.length === 0, JSON.stringify(popins));
  await page.screenshot({ path: `${shots}/t29-ready.png` });

  // ── 2. version in the menu ───────────────────────────────────────────
  await page.getByRole('button', { name: 'Menü', exact: true }).click();
  const label = await page.locator('.v5-version').textContent();
  check('the menu ends with the app version', label === `v${real.version}` && /^v5\.7\.\d+$/.test(label ?? ''), `${label} / ${real.version}`);
  await page.screenshot({ path: `${shots}/t29-menu.png` });
  await page.keyboard.press('Escape');

  // ── 3. no zoom: viewport and gesture events ──────────────────────────
  const zoom = await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(e); return { meta: document.querySelector('meta[name=viewport]').content, prevented: e.defaultPrevented, touch: getComputedStyle(document.documentElement).touchAction }; });
  check('pinch and double-tap zoom are off on the field map', /user-scalable=no/.test(zoom.meta) && /maximum-scale=1/.test(zoom.meta) && zoom.prevented && zoom.touch === 'manipulation', JSON.stringify(zoom));
  await context.close();
}

// ── 4. the organiser pages: dark first paint, no zoom, start screen goes ─
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await open(context, `${BASE}/login`);
  await page.waitForSelector('#splash', { state: 'attached', timeout: 5000 });
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  check('the sign-in page also starts dark', isDark(bg), bg);
  await page.waitForSelector('.ui-page, form', { timeout: 15000 });
  check('and its start screen goes away', await until(async () => !(await page.evaluate(() => !!document.getElementById('splash')))));
  const zoom = await page.evaluate(() => { const e = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(e); return { meta: document.querySelector('meta[name=viewport]').content, prevented: e.defaultPrevented }; });
  check('no zoom on the organiser pages either', /user-scalable=no/.test(zoom.meta) && zoom.prevented, JSON.stringify(zoom));
  await context.close();
}

// ── 5. a newer build online: reload once at the start, banner while running ─
{
  const context = await newContext();
  let versionAsks = 0;
  const newer = { ...real, version: `5.7.${Number(real.build) + 5}`, build: String(Number(real.build) + 5), sha: 'fffffff' };
  await context.route('**/version.json', (route) => { versionAsks++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(newer) }); });
  let documentLoads = 0;
  context.on('request', (request) => { if (request.isNavigationRequest() && request.url().includes('/v5.html')) documentLoads++; });
  const page = await open(context);
  await awaitReady(page);
  await until(async () => documentLoads >= 2, 15000);
  check('a start with a newer build online reloads once', documentLoads === 2, `loads=${documentLoads}`);
  const banner = page.locator('.pwa-banner');
  await banner.waitFor({ timeout: 15000 });
  check('after that a banner offers the update (no endless reload)', (await banner.textContent()).includes(`v${newer.version}`) && documentLoads === 2, `${await banner.textContent()} loads=${documentLoads}`);
  await page.screenshot({ path: `${shots}/t29-banner.png` });
  const before = documentLoads;
  await banner.getByRole('button', { name: 'Aktualisieren' }).click();
  await until(async () => documentLoads > before, 10000);
  check('tapping Aktualisieren reloads', documentLoads === before + 1, `loads=${documentLoads}`);
  await context.close();
}

// ── 6. the undo bar follows the theme ────────────────────────────────────
{
  const context = await newContext();
  const page = await open(context);
  await awaitReady(page);
  await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 });
  await page.evaluate(async () => { const m = window.__v5Map; m.jumpTo({ center: [13 + 100 / 70053, 51], zoom: 18.1 }); await new Promise((r) => m.once('idle', r)); });
  await startMarking(page);
  await setMode(page, 'Tippen');
  // tapping a house with the tap tool marks it: the undo bar appears
  const hit = await page.evaluate(() => { const m = window.__v5Map; for (const f of m.queryRenderedFeatures({ layers: ['v5-houses-fill'] })) { const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : null; if (!ring) continue; const xs = ring.map((c) => m.project(c).x), ys = ring.map((c) => m.project(c).y); const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2; if (x > 20 && x < 370 && y > 120 && y < 650) return [x, y]; } return null; });
  if (hit) await page.mouse.click(hit[0], hit[1]);
  const toast = page.locator('.v5-toast');
  const shown = await toast.waitFor({ timeout: 8000 }).then(() => true, () => false);
  if (shown) {
    const lum = await toast.evaluate((el) => { const [r, g, b] = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; });
    check('the undo bar is dark in the dark theme', lum < 0.3, String(lum));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/t29-toast.png` });
  } else check('the undo bar showed up for the test', false, 'no toast');
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

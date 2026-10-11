// One-hand and two-finger handling of the map while marking, with real touch events (CDP): a finger that moves first pans the map, one that rests a
// moment starts Wischen / Lasso, two fingers zoom and never start a lasso, a lifted finger whose "up" never arrived cannot block the next gesture,
// and a tap a good way beside a street still picks that street (Strecke).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { startMarking, setMode, setBrush } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const page = await context.newPage();
page.on('pageerror', (error) => check(`page error ${error.message}`, false));
const cdp = await context.newCDPSession(page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
/** A finger: down at the first point, optionally rest, then along the path, then up. */
async function fingerPath(path, { rest = 0, steps = 10 } = {}) {
  await send('touchStart', [path[0]]);
  if (rest) await sleep(rest);
  let [px, py] = path[0];
  for (const [x, y] of path.slice(1)) {
    for (let i = 1; i <= steps; i++) { await send('touchMove', [[px + ((x - px) * i) / steps, py + ((y - py) * i) / steps]]); await sleep(8); }
    [px, py] = [x, y];
  }
  await send('touchEnd', []);
}

await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 180000 });
await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
await page.waitForTimeout(1200);
const jump = (x, y, z) => page.evaluate(async ([c, zoom]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), z]);
const at = (x, y) => page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y));
const view = () => page.evaluate(() => { const m = window.__v5Map; const c = m.getCenter(); return { lng: c.lng, lat: c.lat, zoom: m.getZoom() }; });
const done = async () => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const drawn = () => page.evaluate(() => window.__v5Map.querySourceFeatures('v5-draw').length);
const moved = (a, b) => Math.hypot((b.lng - a.lng) * 70053, (b.lat - a.lat) * 110574);

await jump(126, 13, 18.1);
if (process.env.DEBUG_EVENTS) await page.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(t, (e) => window.__ev.push(`${t}:${e.pointerId}:${e.isPrimary}:${(e.target.className || e.target.tagName).toString().slice(0, 24)}`), true); for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) window.addEventListener(t, (e) => window.__ev.push(`${t}:${e.cancelable}:${e.defaultPrevented}`), { capture: true, passive: true }); });
await startMarking(page);
await setMode(page, 'Wischen');
const settle = () => page.locator('.v5-fab').evaluate(async (el) => { await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)); }); // the panel morphs with a transition
await settle();
const [hx, hy] = await at(106, 13), [hx2, hy2] = await at(166, 13);

// ── a finger that moves first pans the map, in both drawing modes ──
const onMap = (x, y) => page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.maplibregl-map'), [x, y]);
{
  // while the marking panel is open the right column is as wide as the panel; beside the narrower zoom buttons lies its empty space
  const zoom = await page.getByRole('button', { name: 'Hineinzoomen', exact: true }).boundingBox();
  const [px, py] = [zoom.x - 40, zoom.y + zoom.height / 2];
  const before = await onMap(px, py);
  await page.addStyleTag({ content: '.v5-ctl, .v5-topright { pointer-events: auto !important; }' }); // what it used to be
  const old = await onMap(px, py);
  await page.evaluate(() => document.head.lastElementChild.remove());
  check('the empty space beside the zoom buttons belongs to the map, not to an invisible control box (it did before)', before && !old, `now ${before}, before ${old}`);
}
{
  const before = await view(), marks = await done();
  if (process.env.DEBUG_EVENTS) console.log('chain', JSON.stringify(await page.evaluate(([x, y]) => { const out = []; for (let e = document.elementFromPoint(x, y); e; e = e.parentElement) out.push(`${(e.className || e.tagName).toString().slice(0, 30)}=${getComputedStyle(e).touchAction}`); return { out, drag: window.__v5Map.dragPan.isEnabled(), zoom: window.__v5Map.touchZoomRotate.isEnabled(), cls: document.querySelector('.maplibregl-canvas-container').className }; }, [hx, hy])));
  await fingerPath([[hx, hy], [hx + 90, hy + 60]]);
  await page.waitForTimeout(300);
  const after = await view();
  if (process.env.DEBUG_EVENTS) console.log('events', JSON.stringify(await page.evaluate(() => window.__ev.slice(-40))));
  check('Wischen: a quick one-finger drag over houses moves the map and marks nothing', moved(before, after) > 15 && (await done()) === marks, `${moved(before, after).toFixed(1)} m, marks ${marks} → ${await done()}`);
}
await jump(126, 13, 18.1);
{
  const [ax, ay] = await at(106, 13), [bx, by] = await at(166, 13);
  const before = await view(), marks = await done();
  await fingerPath([[ax, ay], [bx, by]], { rest: 260 });
  const marked = await until(async () => (await done()) > marks, 5000);
  const after = await view();
  check('Wischen: resting a moment, then dragging along the houses marks them and does not move the map', marked && moved(before, after) < 1, `marks ${marks} → ${await done()}, moved ${moved(before, after).toFixed(1)} m`);
}

// ── two fingers zoom and never start the drawing tool ──
await setMode(page, 'Lasso');
await jump(126, 13, 17);
{
  const z0 = (await view()).zoom;
  await send('touchStart', [[150, 400]]);
  await sleep(40);
  await send('touchStart', [[150, 400], [240, 400]]);
  for (let i = 1; i <= 12; i++) { await send('touchMove', [[150 - i * 6, 400], [240 + i * 6, 400]]); await sleep(16); }
  const during = await drawn();
  await send('touchEnd', []);
  await page.waitForTimeout(400);
  const z1 = (await view()).zoom;
  check('Lasso: two fingers zoom the map in', z1 > z0 + 0.3, `${z0.toFixed(2)} → ${z1.toFixed(2)}`);
  check('Lasso: and no outline is drawn while they do', during === 0, String(during));
}
// two fingers that land a beat apart (the first one is already resting) still pinch
await jump(126, 13, 17);
{
  const z0 = (await view()).zoom;
  await send('touchStart', [[150, 400]]);
  await sleep(110);
  await send('touchStart', [[150, 400], [240, 400]]);
  for (let i = 1; i <= 12; i++) { await send('touchMove', [[150 - i * 6, 400], [240 + i * 6, 400]]); await sleep(16); }
  await send('touchEnd', []);
  await page.waitForTimeout(400);
  check('Lasso: a second finger that comes a moment later still pinches', (await view()).zoom > z0 + 0.3, `${z0.toFixed(2)} → ${(await view()).zoom.toFixed(2)}`);
}
// the map can be panned again right after, with one finger
{
  const before = await view();
  await fingerPath([[200, 500], [120, 420]]);
  await page.waitForTimeout(300);
  check('Lasso: after the pinch one finger pans the map again', moved(before, await view()) > 8, `${moved(before, await view()).toFixed(1)} m`);
}

// ── a finger whose "up" never came does not block the next gesture ──
await setMode(page, 'Wischen');
await setBrush(page, 'Später'); // the houses of the first paint are done already: painting them again must change something
check('the brush is Später now', await until(async () => /Später/.test(await page.locator('.v5-caption').innerText().catch(() => ''))), await page.locator('.v5-caption').innerText().catch(() => ''));
await jump(126, 13, 18.1);
await page.evaluate(() => {
  const el = document.querySelector('.maplibregl-canvas-container');
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', isPrimary: false, clientX: 20, clientY: 300, bubbles: true }));
});
{
  const [ax, ay] = await at(106, 13), [bx, by] = await at(166, 13);
  const marks = await done();
  await fingerPath([[ax, ay], [bx, by]], { rest: 260 });
  check('a finger that never reported "up" cannot block painting', await until(async () => (await done()) < marks, 5000), `${marks} → ${await done()}`);
  const before = await view();
  await fingerPath([[200, 500], [120, 420]]);
  await page.waitForTimeout(300);
  check('nor panning', moved(before, await view()) > 8);
}

// ── Strecke: a tap a good way beside the street still picks the street ──
await setMode(page, 'Strecke');
await jump(126, 0, 17.4);
{
  const [sx, sy] = await at(126, 0);
  const counter = () => page.locator('.v5-fab .v5-tile b').first().innerText().catch(() => '');
  const was = Number(await counter() || 0);
  await send('touchStart', [[sx + 40, sy + 11]]); await sleep(40); await send('touchEnd', []);
  await page.waitForTimeout(500);
  check('Strecke: a tap 11 px beside the street line picks it', Number(await counter() || 0) === was + 1, `${was} → ${await counter()}`);
}
await page.screenshot({ path: `${shots}/t20-touch.png` });
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

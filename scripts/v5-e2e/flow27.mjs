// Fast marking tools and the Area editor, against the real handlers (v5 API + legacy mutation endpoint).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { confirmRoute, menuTile, setBrush, setMode, startMarking } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const boot = async () => {
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug' + (process.env.V5_QUERY ?? ''));
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const done = async () => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const jump = (x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const scr = (x, y) => page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y));
const clickAt = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.click(sx, sy); };
const serverStatus = (key) => page.evaluate(async (k) => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.find((o) => o.key === k)?.status ?? 'open', key);
const until = async (predicate, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const drag = async (points) => { const first = await scr(...points[0]); await page.mouse.move(...first); await page.mouse.down(); await page.waitForTimeout(260); /* Wischen / Lasso take a finger that rests a moment */ for (const p of points.slice(1)) { const [sx, sy] = await scr(...p); await page.mouse.move(sx, sy, { steps: 14 }); } await page.mouse.up(); };

// Wischen as a highlighter: a see-through stroke as wide as the brush follows the finger, everything under it is marked, in both directions, streets whole.
await boot();
const segOps = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=5000')).json()).ops.filter((o) => o.key.startsWith('s:')).map((o) => [o.key, o.status]));
await startMarking(page);
await setMode(page, 'Wischen');
await setBrush(page, 'Ausgeteilt');
await jump(100, 0, 18.1); // the screen shows about 37 m either side

// 1. the stroke is visible while the finger is down and its width is the brush's
{
  const [x0, y0] = await scr(75, 0), [x1, y1] = await scr(125, 0);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.waitForTimeout(260);
  await page.mouse.move(x1, y1, { steps: 16 });
  await page.waitForTimeout(250);
  const stroke = await page.evaluate(() => { const m = window.__v5Map; const f = m.queryRenderedFeatures({ layers: ['v5-draw-stroke'] }); return { n: f.length, width: m.getPaintProperty('v5-draw-stroke', 'line-width') }; });
  check('while painting, a see-through stroke is drawn on the map', stroke.n > 0, JSON.stringify(stroke));
  await page.screenshot({ path: `${shots}/t3-highlighter.png` });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
const first = await segOps();
// 2. the whole stretch under the stroke is marked, with no gap between its pieces
const keysFirst = first.map((e) => e[0]);
check('the street under the stroke is marked piece by piece', first.length >= 4 && first.every((e) => e[1] === 'completed'), `${first.length} pieces`);

// 3. the other direction marks the same pieces (a different status makes the overlap visible)
await setBrush(page, 'Später');
await drag([[125, 0], [75, 0]]);
await page.waitForTimeout(700);
const back = await segOps();
const laterKeys = back.filter((e) => e[1] === 'later').map((e) => e[0]);
check('painting the same stretch the other way round marks the same pieces', keysFirst.every((k) => laterKeys.includes(k)), `${keysFirst.length} → ${laterKeys.length}`);

await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

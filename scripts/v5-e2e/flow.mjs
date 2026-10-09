// Core flow with assertions: mark → undo → sync → fresh client → route marking → read-only viewer.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { openMenu, startMarking, confirmRoute } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const open = async (who) => {
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addCookies([{ name: 'vf_session', value: cookies[who], url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug' + (process.env.V5_QUERY ?? ''));
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
};
const done = async (page) => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const jump = (page, x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const clickAt = async (page, x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };

let { ctx, page } = await open('admin');
const start = await done(page);
check('boots with a progress readout', start >= 0, `${start} done`);
await jump(page, 116, 13, 18.1);
await clickAt(page, 116, 13);
await page.waitForSelector('.v5-sheet');
check('tapping a house opens its sheet', /Querstraße 1 \d+/.test(await page.locator('.v5-sheet h2').innerText()));
check('the status group has four icon buttons', (await page.locator('.v5-status').count()) === 4);
await page.getByRole('button', { name: 'Ausgeteilt' }).first().click();
await page.waitForTimeout(500);
check('marking raises the counter by one', (await done(page)) === start + 1);
await page.screenshot({ path: `${shots}/f1-marked.png` });
await page.getByRole('button', { name: 'Rückgängig' }).click();
await page.waitForTimeout(400);
check('undo restores the counter', (await done(page)) === start);
// A second house (not touched by the undo test) is the one the fresh client must see.
await clickAt(page, 136, 13);
await page.waitForFunction(() => document.querySelector('.v5-sheet h2')?.textContent?.includes('Querstraße 1'));
await page.getByRole('button', { name: 'Ausgeteilt' }).first().click();
// The indicator can still say 'saved' for the first ~50 ms after a tap, so wait for the server itself.
const serverHas = (key, status) => page.evaluate(async ([k, st]) => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.some((o) => o.key === k && o.status === st), [key, status]);
const until = async (predicate, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
check('the edit reaches the server', await until(() => serverHas('h:h5000098', 'completed')));
await ctx.close();

({ ctx, page } = await open('admin'));
const fresh = await done(page);
if (process.env.V5_DEBUG) console.log('DEBUG pill:', JSON.stringify(await page.locator('.v5-pill').innerText()), 'server rows:', await page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.map((o) => o.key + '=' + o.status).join(','))); check('a fresh client (empty IndexedDB) sees the server state', fresh === start + 1, `fresh=${fresh} start=${start}`);
await jump(page, 200, 0, 15.8);
await startMarking(page);
await clickAt(page, 25, 0); await clickAt(page, 375, 0);
await page.waitForTimeout(900);
const meta = await page.locator('.v5-caption').innerText();
check('route sheet reports 8 chunks and 400 m', /8/.test(meta) && /400 m/.test(meta), meta.replace(/\n/g, ' '));
await page.screenshot({ path: `${shots}/f2-route.png` });
const beforeRoute = await done(page);
await confirmRoute(page);
await page.waitForTimeout(1500);
check('route marking completes the houses along the street', (await done(page)) - beforeRoute >= 10, `+${(await done(page)) - beforeRoute}`);
const chunkKeys = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.filter((o) => o.key.startsWith('s:') && o.key.includes('~') && o.status === 'completed').length);
check('chunk keys (s:…~k) are stored by the server, not refused', await until(async () => (await chunkKeys()) >= 6), String(await chunkKeys()));
await ctx.close();

// Theme switch keeps (or restores) our layers, geometry and status on the new basemap.
({ ctx, page } = await open('admin'));
await openMenu(page);
await page.getByRole('button', { name: 'Hell', exact: true }).click();
await page.waitForTimeout(3000);
const themed = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, line: !!window.__v5Map.getLayer('v5-segments-line'), houses: (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')) ? 1 : 0 }));
check('switching to the light theme re-installs the map layers', themed.theme === 'light' && themed.line && themed.houses === 1, JSON.stringify(themed));
await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
await page.waitForTimeout(2500);
check('and back to dark', await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && !!window.__v5Map.getLayer('v5-segments-line')));
await ctx.close();

({ ctx, page } = await open('viewer'));
check('viewer is read-only: no mark tool, an eye marker instead', (await page.getByRole('button', { name: 'Markieren starten' }).count()) === 0 && (await page.locator('.v5-viewonly').count()) === 1);
await jump(page, 116, 13, 18.1); await clickAt(page, 116, 13); await page.waitForSelector('.v5-sheet');
check('viewer sees the status but no buttons', (await page.locator('.v5-status').count()) === 0);
await ctx.close();
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

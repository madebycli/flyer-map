// Extended flow: legacy-progress import, offline outbox, team-editor scope, timing at city scale.
// Needs the server from server.ts (CITY_BLOCKS=12 for the correctness checks, 70 for the scale check).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const BLOCKS = Number(process.env.CITY_BLOCKS ?? 12);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];

const open = async (who, { buildIfNeeded = false } = {}) => {
  const ctx = await b.newContext({ viewport: { width: 420, height: 800 } });
  await ctx.addCookies([{ name: 'vf_session', value: cookies[who], url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const t = Date.now();
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  if (buildIfNeeded) await page.getByText('Kartendaten fehlen').waitFor({ timeout: 8000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 240000 });
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getSource('v5-houses'), null, { timeout: 60000 });
  const bootMs = Date.now() - t;
  await page.waitForTimeout(1200);
  return { ctx, page, bootMs };
};
const pill = async (page) => `${await page.locator('.v5-pill').getAttribute('data-done')} / ${await page.locator('.v5-pill').getAttribute('data-total')}`;
const jump = (page, x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const clickAt = async (page, x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
const serverState = async (page) => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops);

// 1. Admin boots (building the pack the first time) and imports the legacy progress.
let { ctx, page, bootMs } = await open('admin', { buildIfNeeded: true });
console.log(`boot incl. pack build + derive: ${bootMs} ms, ${await pill(page)}`);
await page.getByRole('button', { name: 'Mehr' }).click();
const importButton = page.getByRole('button', { name: /Fortschritt aus der bisherigen Version/ });
check('import offer is visible for an admin with an empty overlay', await importButton.isVisible());
await importButton.click();
await page.waitForSelector('.v5-toast');
const toast = await page.locator('.v5-toast').innerText();
check('import reports matched houses and street ranges', /5 Häuser und 1 Straßenabschnitte übernommen/.test(toast), toast.replace(/\n/g, ' '));
await page.waitForTimeout(1500);
check('progress counts the five imported houses', /^.*\b5 \/ /.test(await pill(page)), await pill(page));
const imported = await serverState(page);
check('imported progress reached the server', imported.filter((o) => o.key.startsWith('h:')).length === 5 && imported.some((o) => o.key.startsWith('s:')), `${imported.length} rows`);
await page.screenshot({ path: `${shots}/6-imported.png` });
await ctx.close();

// 2. Offline outbox: API unreachable after load; edits queue, persist to IndexedDB, and arrive after reconnect.
({ ctx, page } = await open('admin'));
let blocked = false;
await page.route('**/api/**', (route) => (blocked ? route.abort() : route.continue()));
blocked = true;
await jump(page, 76, 87, 18.4);
await clickAt(page, 76, 87);
await page.waitForSelector('.v5-sheet');
await page.getByRole('button', { name: 'Erledigt' }).first().click();
await page.waitForTimeout(500);
const before = (await serverState(page).catch(() => null));
check('offline: the API is really unreachable', before === null);
const idb = await page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('vf-v5-campaign_n', 1);
  req.onsuccess = () => { const g = req.result.transaction('state').objectStore('state').get('outbox'); g.onsuccess = () => resolve(g.result?.pending?.length ?? -1); g.onerror = () => resolve(-2); };
  req.onerror = () => resolve(-3);
}));
check('offline edit is in the persisted outbox immediately', idb >= 1, `pending=${idb}`);
await page.waitForTimeout(2500);
check('sync indicator shows offline', (await page.locator('.v5-dot').getAttribute('class')).includes('offline'));
blocked = false;
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => document.querySelector('.v5-dot')?.className.includes('ok'), null, { timeout: 30000 }).catch(() => {});
const after = await serverState(page);
check('after reconnect the offline edit reached the server', after.filter((o) => o.key.startsWith('h:')).length === 6, `${after.filter((o) => o.key.startsWith('h:')).length} house rows`);
await ctx.close();

// 3. Team editor: sees only the own area and can still mark.
({ ctx, page } = await open('editor'));
const area = await page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/meta')).json()).areas.map((a) => a.id));
check('editor receives only the own team area', area.length === 1 && area[0] === 'area_n', JSON.stringify(area));
await jump(page, 16, 13, 18.4); await clickAt(page, 16, 13);
check('editor gets status buttons', (await page.waitForSelector('.v5-sheet').then(() => page.locator('.v5-status').count())) === 4);
await ctx.close();

// 4. Scale timing (only meaningful with a big city).
if (BLOCKS >= 40) {
  ({ ctx, page, bootMs } = await open('admin'));
  const info = await page.evaluate(() => document.querySelector('.v5-pill small')?.textContent);
  console.log(`scale: ${BLOCKS}x${BLOCKS} blocks, boot ${bootMs} ms, ${info}`);
  await page.screenshot({ path: `${shots}/7-scale.png` });
  await ctx.close();
}
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

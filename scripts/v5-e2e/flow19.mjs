// A big Gebiet (BIG_AREA=1: about 45 km², nine parts): the parts are built, fetched, derived and merged into the same city as one pack gives,
// the second start comes from the device cache part by part, and the camera / counts hold. Run: BIG_AREA=1 node scripts/v5-e2e/run-all.mjs flow19
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
if (!process.env.BIG_AREA) { console.log('FAIL  this flow needs BIG_AREA=1'); process.exit(1); }
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
async function open() {
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const boots = [];
  page.on('console', (m) => { const t = m.text(); if (t.startsWith('[v5 boot ms]')) boots.push(JSON.parse(t.slice(12))); });
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug&parts=all');
  const needed = await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (needed) await page.getByRole('button', { name: 'Kartendaten laden' }).click();
  await page.waitForSelector('.v5-pill', { timeout: 240000 });
  await page.waitForFunction(() => window.__v5Boot, null, { timeout: 120000 });
  // a first start shows the first parts and loads the rest behind the map: wait for the notice to be gone
  await page.waitForFunction(() => ![...document.querySelectorAll('[role=status]')].some((e) => /Weitere Kartendaten/.test(e.textContent ?? '')), null, { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Boot && !document.querySelector('.v5-pill[data-total="0"]'), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getSource('v5-tiles'), null, { timeout: 60000 });
  const boot = await page.evaluate(() => window.__v5Boot);
  const houses = Number(await page.locator('.v5-pill').getAttribute('data-total'));
  return { page, requests, boot, boots, houses, needed };
}
const first = await open();
const posts = first.requests.filter((r) => /^POST .*\/pack\?part=\d+/.test(r));
const gets = first.requests.filter((r) => /^GET .*\/pack\?part=\d+/.test(r));
check('a new big Gebiet asks for its map data first, then builds it part by part', first.needed && posts.length >= 9, `${first.needed} ${posts.length} builds`);
check('the first start showed the first parts and loaded the rest behind the map (two steps; the second has nothing left out)', first.boots.some((x) => x.deferred >= 1) && first.boots.at(-1).deferred === 0, JSON.stringify(first.boots.map((x) => x.deferred)));
check('every part was fetched once for the start', gets.length === posts.length, `${gets.length} fetched / ${posts.length} built`);
check('the city is there in full (same houses as with one pack: 1159)', first.houses === 1159, String(first.houses));
const tiles = await first.page.evaluate(async () => { const m = window.__v5Map; await new Promise((r) => (m.loaded() ? r(null) : m.once('idle', r))); return m.queryRenderedFeatures({ layers: ['v5-segments-line'] }).length; });
const view = await first.page.evaluate(() => ({ zoom: window.__v5Map.getZoom(), center: window.__v5Map.getCenter() }));
check('streets are drawn', tiles > 0, `${tiles} at ${JSON.stringify(view)}`);
await first.page.screenshot({ path: process.env.SHOTS_DIR + '/t19-big.png' });
await first.page.waitForTimeout(2500); // cache writes are fire-and-forget
await first.page.close();
const second = await open();
const gets2 = second.requests.filter((r) => /pack\?part=/.test(r));
check('the second start needs no build and no download of any part', !second.needed && gets2.length === 0, `${gets2.length}`);
check('it comes from the device cache part by part', second.boot.cacheHits >= 9, JSON.stringify(second.boot));
check('with the same houses', second.houses === 1159, String(second.houses));
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

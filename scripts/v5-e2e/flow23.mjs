// A big Gebiet is loaded part by part, as it is looked at (BIG_AREA=1: nine parts): the start loads only some parts, zooming into the others loads them,
// the parts looked at are the ones the next start brings back. Run: BIG_AREA=1 node scripts/v5-e2e/run-all.mjs flow23
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
if (!process.env.BIG_AREA) { console.log('FAIL  this flow needs BIG_AREA=1'); process.exit(1); }
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const total = async (page) => Number(await page.locator('.v5-pill').getAttribute('data-total'));
async function open() {
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  const needed = await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (needed) await page.getByRole('button', { name: 'Kartendaten laden' }).click();
  await page.waitForSelector('.v5-pill', { timeout: 240000 });
  await page.waitForFunction(() => window.__v5Boot && window.__v5Map && window.__v5Map.getSource('v5-tiles'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  return { page, requests, needed };
}
const first = await open();
const p1 = first.page;
const fetched = () => first.requests.filter((r) => /^GET .*\/pack\?part=\d+/.test(r)).length;
const banner = (page) => page.locator('[role=status]', { hasText: 'Kartenteilen geladen' });
const start = await total(p1);
const loadedOf = async (page) => { const t = await banner(page).first().textContent({ timeout: 2000 }).catch(() => ''); const m = /(\d+) von (\d+) Kartenteilen/.exec(t ?? ''); return m ? { loaded: Number(m[1]), total: Number(m[2]) } : null; };
const startParts = await loadedOf(p1);
check('the start brings some parts, not all of them', !!startParts && startParts.loaded > 0 && startParts.loaded < startParts.total && fetched() === startParts.loaded, `${JSON.stringify(startParts)}, ${fetched()} fetched, ${start} houses`);
const meta = await p1.evaluate(() => fetch('/api/v5/campaigns/campaign_n/meta').then((r) => r.json()));
const ring = meta.areas.find((a) => a.packVersion).geometry.coordinates[0];
const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
const [w, s, e, n] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
// look at the Gebiet in a grid at a zoom where parts come in (14)
let seen = start;
for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
  const c = [w + ((i + 0.5) / 5) * (e - w), s + ((j + 0.5) / 5) * (n - s)];
  await p1.evaluate((center) => window.__v5Map.jumpTo({ center, zoom: 14.5 }), c);
  await p1.waitForTimeout(1800); // the view settles (1 s), the reload runs
}
await p1.waitForFunction(() => !document.querySelector('[role=status]')?.textContent?.includes('wird geladen'), null, { timeout: 60000 }).catch(() => {});
await p1.waitForTimeout(6000);
seen = await total(p1);
check('looking at the Gebiet loaded the other parts (all of the city is there)', seen === 1159, `${seen}`);
check('no part was fetched twice', new Set(first.requests.filter((r) => /^GET .*\/pack\?part=\d+/.test(r))).size === fetched(), `${fetched()}`);
const endParts = await loadedOf(p1);
check('more parts are on the device after looking around', endParts === null || endParts.loaded > startParts.loaded, JSON.stringify(endParts));
await p1.close();
const second = await open();
await second.page.waitForTimeout(1500);
const again = await total(second.page);
check('the next start brings back the parts that were looked at', again === 1159, `${again}`);
check('and needs no download for them', second.requests.filter((r) => /pack\?part=/.test(r)).length === 0);
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

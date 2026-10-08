// Warm start: the second open of an Aktion on the same device skips pack download and derivation.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
async function open() {
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 4000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Boot, null, { timeout: 60000 });
  const boot = await page.evaluate(() => window.__v5Boot);
  const houses = Number(await page.locator('.v5-pill').getAttribute('data-total'));
  return { page, requests, boot, houses };
}
const first = await open();
check('cold start downloads the pack', first.requests.some((u) => /\/pack(\?|$)/.test(u)) && first.boot.cacheHits === 0, JSON.stringify(first.boot));
await first.page.waitForTimeout(1500); // the cache write is fire-and-forget
await first.page.close();
const second = await open();
check('warm start uses the cached network for every Area', second.boot.cacheHits >= 1, JSON.stringify(second.boot));
check('and downloads no pack at all', !second.requests.some((u) => /\/pack(\?|$)/.test(u)));
check('same houses as before', second.houses === first.houses && second.houses > 0, `${second.houses}`);
check('and spends no time deriving', second.boot.derive <= 5, `derive ${first.boot.derive} ms → ${second.boot.derive} ms (ready ${first.boot.ready} → ${second.boot.ready} ms; tiny fixture, timings are noise)`);
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

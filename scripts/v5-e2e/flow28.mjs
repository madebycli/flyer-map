// The marking options panel: exactly twelve fields in three even rows, every label whole (two lines at most), nothing cut off, 44 px targets, on a phone and on an iPad.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { longPress, setMode, startMarking } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

for (const [w, h] of [[390, 844], [430, 932], [1373, 833]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w > 1000 });
  await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await startMarking(page);
  await setMode(page, 'Wischen').catch(async () => { await longPress(page, page.locator('.v5-fab-grid .v5-tile').first()); });
  if (!(await page.locator('.v5-fab[data-state="options"]').count())) await page.locator('.v5-fab-grid .v5-tile').first().click();
  await page.waitForSelector('.v5-fab[data-state="options"] .v5-tile');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const fab = document.querySelector('.v5-fab[data-state="options"]').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.v5-fab[data-state="options"] .v5-tile')].map((t) => {
      const q = t.getBoundingClientRect(), s = t.querySelector('small');
      return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height), inside: q.left >= fab.left - 0.5 && q.right <= fab.right + 0.5 && q.top >= fab.top - 0.5 && q.bottom <= fab.bottom + 0.5, cut: s ? s.scrollHeight > s.clientHeight + 1 : false, text: s?.textContent ?? '' };
    });
    return { n: tiles.length, rows: new Set(tiles.map((t) => t.y)).size, small: tiles.filter((t) => t.w < 44 || t.h < 44).length, outside: tiles.filter((t) => !t.inside).length, cut: tiles.filter((t) => t.cut).map((t) => t.text), right: Math.round(window.innerWidth - fab.right), fabW: Math.round(fab.width) };
  });
  const tag = `${w}px`;
  check(`${tag}: twelve fields in three rows`, r.n === 12 && r.rows === 3, JSON.stringify({ n: r.n, rows: r.rows }));
  check(`${tag}: every field inside the panel, none under 44 px`, r.outside === 0 && r.small === 0, JSON.stringify({ outside: r.outside, small: r.small }));
  check(`${tag}: no label is cut off`, r.cut.length === 0, JSON.stringify(r.cut));
  check(`${tag}: the panel fits the screen`, r.right >= 0, JSON.stringify({ right: r.right, fabW: r.fabW }));
  await page.screenshot({ path: `${shots}/t28-options-${w}.png` });
  await ctx.close();
}
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

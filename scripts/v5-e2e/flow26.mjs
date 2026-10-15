// Menus under a touch keyboard: the sheet sits above the keys, never grows past the visible area, the search field stays on screen while a long result
// list scrolls, and a row of choices is one line. The keyboard is simulated with the same variables viewport.ts sets (--kb, --vvh, data-kb).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`); if (!ok) failures++; };

const innerHeightOf = (r) => r.innerHeight;
for (const [tag, width, height, keyboard] of [['phone', 390, 844, 330], ['ipad', 820, 1180, 380]]) {
  const ctx = await b.newContext({ viewport: { width, height }, hasTouch: true });
  await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 4000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Boot && window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await menuTile(page, 'Suche');
  const input = page.locator('.v5-searchbar input');
  await input.waitFor();
  await input.fill('a');
  await page.waitForFunction(() => document.querySelectorAll('.v5-result').length > 6, null, { timeout: 15000 }).catch(() => {});
  const results = await page.locator('.v5-result').count();
  check(`${tag}: the search finds enough to fill a screen`, results > 6, String(results));
  const room = () => page.evaluate(() => {
    const sheet = document.querySelector('.v5-sheet').getBoundingClientRect(), bar = document.querySelector('.v5-searchbar').getBoundingClientRect(), body = document.querySelector('.v5-sheet-body');
    return { top: sheet.top, bottom: sheet.bottom, height: sheet.height, barTop: bar.top, barBottom: bar.bottom, scrolls: body.scrollHeight > body.clientHeight + 1, innerHeight };
  });
  const free = await room();
  check(`${tag}: without a keyboard the sheet leaves the map visible`, free.height <= free.innerHeight * 0.8 + 1, JSON.stringify(free));
  // the keyboard goes up
  await page.evaluate(([kb]) => { const r = document.documentElement; r.style.setProperty('--kb', `${kb}px`); r.style.setProperty('--vvh', `${innerHeight - kb}px`); r.setAttribute('data-kb', ''); }, [keyboard]);
  await page.waitForTimeout(300);
  const up = await room();
  check(`${tag}: with a keyboard the sheet is no floating window: it stays flush with the bottom edge`, Math.abs(up.bottom - up.innerHeight) < 1, JSON.stringify(up));
  check(`${tag}: and its top stays inside the visible area`, up.top >= 0 && up.top < up.innerHeight - keyboard, JSON.stringify(up));
  check(`${tag}: the search field is on screen, above the keys`, up.barTop >= 0 && up.barBottom <= up.innerHeight - keyboard, JSON.stringify(up));
  check(`${tag}: the long list scrolls inside the sheet`, up.scrolls);
  await page.locator('.v5-sheet-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const scrolled = await room();
  check(`${tag}: after scrolling the list to its end the search field has not moved`, Math.abs(scrolled.barTop - up.barTop) < 1 && Math.abs(scrolled.top - up.top) < 1, `${up.barTop} → ${scrolled.barTop}`);
  const lastRow = await page.evaluate(() => { const rows = document.querySelectorAll('.v5-result'); return rows[rows.length - 1].getBoundingClientRect().bottom; });
  check(`${tag}: the last result can be scrolled above the keys`, lastRow <= innerHeightOf(up) - keyboard + 1, `${lastRow}`);
  await page.screenshot({ path: `${shots}/kb-${tag}.png` });
  await page.evaluate(() => { const r = document.documentElement; r.style.removeProperty('--kb'); r.style.removeProperty('--vvh'); r.removeAttribute('data-kb'); });
  await page.getByRole('button', { name: 'Schließen' }).click();

  // a row of choices is one line: the groups of a Gebiet
  await menuTile(page, 'Gebiete');
  await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
  await page.waitForTimeout(1200);
  const pt = await page.evaluate(() => { const p = window.__v5Map.project([13.0075, 51.0045]); return [p.x, p.y]; });
  await page.mouse.click(pt[0], pt[1]);
  const chips = page.getByRole('group', { name: 'Gruppe des Gebiets' });
  await chips.waitFor({ timeout: 10000 }).catch(() => {});
  if (await chips.count()) {
    const lines = await chips.locator('button').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    check(`${tag}: the group choice is one line`, lines === 1, String(lines));
    await page.screenshot({ path: `${shots}/area-${tag}-new.png` });
  } else check(`${tag}: the Gebiet sheet opens`, false);
  await ctx.close();
}
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

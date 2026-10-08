// Needs playwright-core (set PLAYWRIGHT_CORE to its index.mjs) and a Chromium (CHROMIUM_PATH).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--no-proxy-server'] });
const open = async (who) => {
  const ctx = await b.newContext({ viewport: { width: 420, height: 800 } });
  await ctx.addCookies([{ name: 'vf_session', value: cookies[who], url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.waitForSelector('.v5-pill', { timeout: 60000 });
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getSource('v5-houses'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
};
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const jump = async (page, x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const clickAt = async (page, x, y) => { const p = await page.evaluate((c) => { const pt = window.__v5Map.project(c); return [pt.x, pt.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
const pill = async (page) => (await page.locator('.v5-pill').innerText()).replace(/\n/g, ' | ');

let { ctx, page } = await open('admin');
console.log('1 start:', await pill(page));
await jump(page, 16, 13, 18.4);
await clickAt(page, 16, 13);
await page.waitForSelector('.v5-sheet');
console.log('2 sheet:', (await page.locator('.v5-sheet h2').innerText()), '|', (await page.locator('.v5-sheet .v5-muted').first().innerText()));
await page.getByRole('button', { name: 'Erledigt' }).first().click();
await page.waitForTimeout(600);
console.log('3 after mark:', await pill(page), '| toast:', await page.locator('.v5-toast').innerText().catch(() => 'none'));
await page.screenshot({ path: `${shots}/3-house-marked.png` });
await page.waitForTimeout(1500);
console.log('3b sync dot class:', await page.locator('.v5-dot').getAttribute('class'));
// Undo then redo.
await page.getByRole('button', { name: 'Rückgängig' }).click();
await page.waitForTimeout(400);
console.log('4 after undo:', await pill(page));
await page.getByRole('button', { name: 'Erledigt' }).first().click();
await page.waitForTimeout(1500);
console.log('5 re-marked:', await pill(page));
await ctx.close();

// Persistence: a fresh context (no IndexedDB) must get the state from the server.
({ ctx, page } = await open('admin'));
console.log('6 fresh client:', await pill(page));
// Route marking along Querstraße 1 from x=50 to x=350.
await jump(page, 200, 0, 15.6);
await page.getByRole('button', { name: 'Strecke markieren' }).click();
await clickAt(page, 50, 0);
await clickAt(page, 350, 0);
await page.waitForTimeout(800);
console.log('7 route sheet:', (await page.locator('.v5-sheet').innerText()).replace(/\n/g, ' | ').slice(0, 220));
await page.screenshot({ path: `${shots}/4-route-preview.png` });
await page.locator('.v5-sheet').getByRole('button', { name: 'Erledigt' }).click();
await page.waitForTimeout(1500);
console.log('8 after route:', await pill(page));
await page.screenshot({ path: `${shots}/5-route-done.png` });
await ctx.close();

// Viewer is read-only.
({ ctx, page } = await open('viewer'));
console.log('9 viewer:', await pill(page), '| fab:', await page.getByRole('button', { name: 'Strecke markieren' }).count(), '| banner:', await page.locator('.v5-banner').count());
await jump(page, 16, 13, 18.4); await clickAt(page, 16, 13); await page.waitForSelector('.v5-sheet');
console.log('10 viewer status buttons:', await page.locator('.v5-status').count());
await ctx.close();
await b.close();

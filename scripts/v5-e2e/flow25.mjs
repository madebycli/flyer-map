// To-do notes (boxes to tick, synced as note text) and the brainrot window (hold the menu for five seconds; move it, make it bigger and smaller by finger).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const until = async (predicate, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, hasTouch: true });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 4000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 120000 });
await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')) && window.__v5Map.getSource('v5-notes'), null, { timeout: 60000 });
await page.waitForTimeout(800);

// ── to-do notes ──
await page.evaluate(async ([c, zoom]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom }); await new Promise((r) => m.once('idle', r)); }, [M(116, 13), 18.1]);
const at = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(116, 13));
await page.mouse.click(at[0], at[1]);
await page.waitForSelector('.v5-sheet');
await page.getByRole('button', { name: 'Als Aufgabe zum Abhaken' }).click();
const input = page.getByLabel('Aufgabe', { exact: true });
await input.fill('Tor prüfen'); await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
await input.fill('Briefkasten nochmal'); await page.getByRole('button', { name: 'Aufgabe speichern' }).click();
check('two tasks make one list with two boxes', (await page.getByRole('checkbox').count()) === 2 && (await page.locator('.v5-note').count()) === 1);
const box = page.getByRole('checkbox', { name: 'Tor prüfen' });
check('a box is at least 44 px high', (await box.boundingBox()).height >= 44);
await box.click();
check('ticking marks it as done', (await box.getAttribute('aria-checked')) === 'true' && (await page.getByRole('checkbox', { name: 'Briefkasten nochmal' }).getAttribute('aria-checked')) === 'false');
const server = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/notes?since=0')).json()).notes);
check('the tick reaches the server as the note text', await until(async () => (await server()).some((n) => n.text === '- [x] Tor prüfen\n- [ ] Briefkasten nochmal')));
await box.click();
check('ticking again takes it back', (await box.getAttribute('aria-checked')) === 'false');
await page.getByRole('button', { name: 'Notiz löschen' }).first().click();
check('the list can be deleted', (await page.locator('.v5-note').count()) === 0);
await page.keyboard.press('Escape').catch(() => {});

// ── brainrot window ──
await page.route('**/youtube-nocookie.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#123"></body></html>' }));
const menu = page.getByRole('button', { name: 'Menü', exact: true });
if (!(await menu.count())) { await page.locator('.v5-sheet').getByRole('button', { name: /schließen|Fertig/i }).first().click().catch(() => {}); }
const mb = await menu.boundingBox();
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down();
await page.waitForTimeout(5400);
await page.mouse.up();
await page.waitForSelector('.v5-pip', { timeout: 5000 });
check('holding the menu for five seconds opens the window', (await page.locator('.v5-pip').count()) === 1);
check('and the hold does not open the menu', (await page.getByText('Aktion', { exact: false }).locator('visible=true').count()) >= 0 && (await page.locator('.v5-sheet').count()) === 0);
const rect = () => page.locator('.v5-pip').boundingBox();
const r0 = await rect();
check('it is 16:9 and inside the screen', Math.abs(r0.width / r0.height - 16 / 9) < 0.05 && r0.x >= 0 && r0.x + r0.width <= 430 && r0.y >= 0 && r0.y + r0.height <= 932, JSON.stringify(r0));
// one finger moves it to the nearest corner
const t = await page.locator('.v5-pip-touch').boundingBox();
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const from = [t.x + t.width / 2, t.y + t.height / 2], to = [from[0] - 150, from[1] + 600];
await touch('touchStart', [from]);
for (let i = 1; i <= 10; i++) { await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / 10, from[1] + ((to[1] - from[1]) * i) / 10]]); await sleep(16); }
await touch('touchEnd', []);
await page.waitForTimeout(400);
const r1 = await rect();
check('one finger moves it, and it settles in the nearest corner (bottom left)', r1.y > 500 && r1.x <= 14 && r1.y + r1.height >= 932 - 14, JSON.stringify(r1));
// two fingers make it bigger
const c = [r1.x + r1.width / 2, r1.y + r1.height / 2];
await touch('touchStart', [[c[0] - 20, c[1]]]); await touch('touchStart', [[c[0] - 20, c[1]], [c[0] + 20, c[1]]]);
for (let i = 1; i <= 10; i++) { const d = 20 + i * 6; await touch('touchMove', [[c[0] - d, c[1]], [c[0] + d, c[1]]]); await sleep(16); }
await touch('touchEnd', []);
await page.waitForTimeout(400);
const r2 = await rect();
check('two fingers apart make it bigger', r2.width > r1.width * 1.5, `${Math.round(r1.width)} → ${Math.round(r2.width)}`);
const c2 = [r2.x + r2.width / 2, r2.y + r2.height / 2];
await touch('touchStart', [[c2[0] - 80, c2[1]]]); await touch('touchStart', [[c2[0] - 80, c2[1]], [c2[0] + 80, c2[1]]]);
for (let i = 1; i <= 10; i++) { const d = 80 - i * 7; await touch('touchMove', [[c2[0] - d, c2[1]], [c2[0] + d, c2[1]]]); await sleep(16); }
await touch('touchEnd', []);
await page.waitForTimeout(400);
const r3 = await rect();
check('two fingers together make it smaller, never below the smallest size', r3.width < r2.width && r3.width >= 139, `${Math.round(r2.width)} → ${Math.round(r3.width)}`);
check('the player surface is hidden: the controls are off and a layer takes the touches', (await page.locator('.v5-pip iframe').getAttribute('src')).includes('controls=0') && (await page.locator('.v5-pip-touch').count()) === 1);
// it stays where it was left
await page.reload();
await page.waitForSelector('.v5-pill', { timeout: 120000 });
// closing
await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
await page.mouse.down(); await page.waitForTimeout(5400); await page.mouse.up();
await page.waitForSelector('.v5-pip', { timeout: 5000 });
const r4 = await rect();
check('the position and size come back at the next opening', Math.abs(r4.width - r3.width) < 3 && Math.abs(r4.x - r3.x) < 3, `${JSON.stringify(r3)} ${JSON.stringify(r4)}`);
await page.getByRole('button', { name: 'Video schließen' }).click();
check('the cross closes it', (await page.locator('.v5-pip').count()) === 0);
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

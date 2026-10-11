// Field shell layout and the Strecke tool, as asked for on the phone: menu bottom-left, "Alles zeigen" in the right column above the zoom,
// the caption bottom-left and clear of the panel, houses can be tapped one by one in Strecke mode, choosing a status ends the mode,
// the sheet handle shrinks the sheet (and the map controls come back), no credit button on the map, no legend / engine line in the overview.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { openMenu, startMarking } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const page = await context.newPage();
page.on('pageerror', (error) => check(`page error ${error.message}`, false));
await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 180000 });
await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
await page.waitForTimeout(1200);

const box = (name, role = 'button') => page.getByRole(role, { name, exact: true }).first().boundingBox();

// ── layout ─────────────────────────────────────────────────────────
const menu = await box('Menü');
check('the menu button sits bottom-left, with the role badge next to it', menu && menu.x < 60 && menu.y > 844 * 0.75 && /Admin/.test(await page.locator('.v5-teamchip').innerText()), JSON.stringify(menu));
check('the top right has help and search, no menu', (await page.locator('.v5-topright button').count()) === 2 && (await page.getByRole('button', { name: 'Hilfe', exact: true }).count()) === 1);
const [fit, plus, locate, fab] = await Promise.all([box('Alles zeigen'), box('Hineinzoomen'), box('Standort aktualisieren'), box('Markieren starten')]);
check('right column from the top: Alles zeigen, zoom, Standort, Markieren', fit && plus && locate && fab && fit.y < plus.y && plus.y < locate.y && locate.y < fab.y, JSON.stringify({ fit, plus, locate, fab }));
check('Alles zeigen is on the right (not left)', fit && fit.x > 390 / 2);
check('no credit button on the map', (await page.locator('.maplibregl-ctrl-attrib-button:visible').count()) === 0);
await page.getByRole('button', { name: 'Alles zeigen', exact: true }).click(); // must not throw
await page.screenshot({ path: `${shots}/t18-layout.png` });

// ── help: role text, questions open on tap, search narrows them ────
await page.getByRole('button', { name: 'Hilfe', exact: true }).click();
await page.locator('.v5-sheet').waitFor();
const helpText = await page.locator('.v5-sheet').innerText();
check('the admin help is for admins (areas, groups), without helper-only chapters', /Hilfe für Admins/.test(helpText) && /Wie lege ich ein Gebiet an/.test(helpText) && !/Wie übernehme ich ein Teilgebiet/.test(helpText));
const total = await page.locator('.v5-faqitem').count();
await page.getByLabel('Fragen durchsuchen').fill('lasso');
check('the search narrows the questions', (await page.locator('.v5-faqitem').count()) >= 1 && (await page.locator('.v5-faqitem').count()) < total);
await page.getByLabel('Fragen durchsuchen').fill('');
await page.locator('.v5-faqitem summary').first().click();
check('a question opens its answer on tap', await page.locator('.v5-faqitem[open] p').first().isVisible());
await page.screenshot({ path: `${shots}/t18-help.png` });
await page.locator('.v5-sheet').getByRole('button', { name: 'Schließen' }).click();
await page.locator('.v5-sheet').waitFor({ state: 'detached' });

// ── Strecke: houses one by one ─────────────────────────────────────
await page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(126, 13), 18.1]);
await startMarking(page);
const caption = page.locator('.v5-caption');
await caption.waitFor();
await page.locator('.v5-fab').evaluate(async (el) => { await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)); }); // the panel grows with a transition
const capBox = await caption.boundingBox();
const panelBox = await page.locator('.v5-fab').boundingBox();
check('while marking the menu button and the role badge give way to the caption, which sits in their row', (await page.getByRole('button', { name: 'Menü', exact: true }).count()) === 0 && (await page.locator('.v5-teamchip').count()) === 0 && capBox.x < 40 && capBox.y + capBox.height > 844 * 0.88 && capBox.x + capBox.width <= panelBox.x + 1, JSON.stringify({ capBox, panelBox }));
check('the panel keeps a margin to the screen edge', panelBox.x + panelBox.width <= 390 - 12 && panelBox.y + panelBox.height <= 844 - 12, JSON.stringify(panelBox));
check('the panel is bigger than before', panelBox.width >= 150, String(panelBox.width));
const done = async () => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const before = await done();
const at = async (x, y) => page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y));
const zoomStart = await page.evaluate(() => window.__v5Map.getZoom());
{
  // two taps in a row without a pause: two points, and no double-tap zoom
  const [x1, y1] = await at(116, 13), [x2, y2] = await at(136, 13);
  await page.mouse.click(x1, y1); await page.mouse.click(x2, y2);
  await page.waitForTimeout(600);
}
const counted = await page.locator('.v5-fab .v5-tile b').innerText().catch(() => '');
check('two quick taps on houses are two points and do not zoom the map', Number(counted) === 2 && Math.abs((await page.evaluate(() => window.__v5Map.getZoom())) - zoomStart) < 0.05, `${counted} zoom ${zoomStart} → ${await page.evaluate(() => window.__v5Map.getZoom())}`);
{
  // A finger moves a little between touching and lifting, and quick taps follow each other: neither may lose a point or zoom the map.
  const [jx, jy] = await at(156, 13);
  await page.mouse.move(jx, jy); await page.mouse.down(); await page.mouse.move(jx + 5, jy + 3); await page.mouse.up();
  await page.waitForTimeout(300);
  check('a tap with a few pixels of finger movement still sets its point', Number(await page.locator('.v5-fab .v5-tile b').innerText().catch(() => '0')) === Number(counted) + 1, await page.locator('.v5-fab .v5-tile b').innerText().catch(() => ''));
}
await page.getByRole('button', { name: 'Strecke bestätigen' }).click();
await page.screenshot({ path: `${shots}/t18-status.png` });
await page.locator('.v5-fab').getByRole('button', { name: 'Ausgeteilt', exact: true }).click();
check('choosing a status ends the marking mode (the button is a single square again)', await until(async () => (await page.locator('.v5-fab').getAttribute('data-state')) === 'idle'));
check('the houses were marked', await until(async () => (await done()) > before), `${before} → ${await done()}`);
check('the caption is gone with the mode', (await page.locator('.v5-caption').count()) === 0);

// ── the sheet handle ───────────────────────────────────────────────
await openMenu(page);
const sheet = page.locator('.v5-sheet');
await sheet.waitFor();
await sheet.evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
const full = await sheet.boundingBox();
const handle = await page.locator('.v5-handle').boundingBox();
check('the handle is a target of at least 44 px', handle.height >= 44, JSON.stringify(handle));
await page.mouse.move(handle.x + handle.width / 2, handle.y + 20);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2, handle.y + 120, { steps: 8 });
await page.mouse.up();
check('dragging the handle down shrinks the sheet to its header', await until(async () => (await sheet.getAttribute('class')).includes('small')));
const small = await sheet.boundingBox();
check('the shrunk sheet is much lower than the full one and still there', small.height < full.height * 0.5 && small.height > 60, `${full.height} → ${small.height}`);
await page.waitForTimeout(500); // the controls fade/slide with a transition
const zoomAfter = await box('Hineinzoomen');
const zoomBefore = { y: fit.y + fit.height + 8 }; // measured before, with no sheet open
check('the controls stay where they were while the sheet is shrunk (nothing moved up)', Math.abs(zoomAfter.y - plus.y) <= 1 && (await box('Menü')).y > small.y - 1, JSON.stringify({ before: plus, after: zoomAfter, small, zoomBefore }));
await page.screenshot({ path: `${shots}/t18-small.png` });
await page.locator('.v5-handle').click();
check('tapping the handle brings the sheet back', await until(async () => !(await sheet.getAttribute('class')).includes('small')));
check('the credit for the map data is in the menu', /OpenStreetMap/.test(await sheet.innerText()));
await sheet.getByRole('button', { name: 'Schließen' }).click();

// ── overview: no legend, no engine line ────────────────────────────
await openMenu(page);
await page.getByRole('button', { name: 'Übersicht', exact: true }).click();
await page.locator('.v5-sheet').waitFor();
const text = await page.locator('.v5-sheet').innerText();
check('the overview has neither the colour legend nor the engine line', !/Was bedeuten die Farben/i.test(text) && !/Kartenmotor/i.test(text));
await page.screenshot({ path: `${shots}/t18-overview.png` });

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

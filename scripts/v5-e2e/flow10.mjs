// Templates, automatic clean-up after reshaping, identity, location preselection and role-aware menu entries.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { encodeClock } from '../../src/v5/store/hlc.ts';
import { deriveNetwork } from '../../src/v5/engine/derive.ts';
import { syntheticCity } from '../../src/v5/engine/synthetic.ts';
import { makeTemplate, serializeTemplate } from '../../src/v5/areas/template.ts';
import { menuTile, openMenu } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M_LNG = 70053, M_LAT = 110574;
const M = (x, y) => [13 + x / M_LNG, 51 + y / M_LAT];
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, permissions: ['geolocation'], geolocation: { latitude: 51 + 450 / M_LAT, longitude: 13 + 300 / M_LNG }, acceptDownloads: true });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };
const boot = async () => {
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getLayer('v5-segments-line'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
};
const serverKeys = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.map((o) => o.key));
const rect = (x0, x1) => [[x0, -400], [x1, -400], [x1, 1300], [x0, 1300], [x0, -400]].map(([x, y]) => M(x, y));

await boot();
// seed: five houses in the west half, five in the east half
const full = deriveNetwork(syntheticCity(12, 12).raw);
const houses = full.houses.map((h) => ({ key: `h:${h.id}`, x: (h.center[0] - 13) * M_LNG }));
const west = houses.filter((h) => h.x < 400).slice(0, 5), east = houses.filter((h) => h.x > 900).slice(0, 5);
const now = Date.now();
const ops = [...west, ...east].map((h, i) => ({ id: encodeClock({ wall: now - 100000 + i, counter: 0, node: 'seed' }), key: h.key, status: 'completed', area: 'area_n' }));
check('seeded progress in both halves', (await page.evaluate(async (o) => (await fetch('/api/v5/campaigns/campaign_n/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: o }) })).status, ops)) === 200);
await page.reload();
await boot();

// identity and role-aware menu
await openMenu(page);
check('the menu shows who this device is', /Admin/.test(await page.locator('.v5-sheet .v5-meta').innerText()));
check('an admin sees Verwaltung and the template entry', (await page.getByRole('button', { name: 'Verwaltung' }).count() + await page.getByRole('link', { name: 'Verwaltung' }).count()) === 1 && (await page.getByRole('button', { name: 'Vorlage laden' }).count()) === 1);
await page.getByRole('button', { name: 'Schließen' }).click();

// location preselection: the position is inside the Area, so tapping "Gebiete" selects it without a tap on the map
await menuTile(page, 'Gebiete');
check('entering Gebiete preselects the Area the person stands in', await until(async () => (await page.locator('.v5-sheet h2').count()) === 1 && /Area/.test(await page.locator('.v5-sheet h2').innerText()), 8000), await page.locator('.v5-sheet h2').allInnerTexts().then((t) => t.join('|')).catch(() => ''));

// export
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Als Vorlage speichern' }).click()]);
const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
check('the template is a small file with outline, name and rules, named safely', exported.format === 'verteil-flyer-area-template' && exported.ring.length === 5 && /\.vorlage\.json$/.test(download.suggestedFilename()) && Object.keys(exported).sort().join() === 'format,name,ring,rules,version', download.suggestedFilename());

// a garbage file is refused in plain words
let [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Vorlage auf dieses Gebiet anwenden' }).click()]);
await chooser.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
check('a foreign file is refused with a reason', await until(async () => /keine Vorlage/.test(await page.locator('.v5-toast').innerText().catch(() => '')), 5000));

// apply a smaller outline to the existing Area: editor opens, ✓ saves, the engine re-derives, what is outside is removed
const small = makeTemplate('West', rect(-300, 650), { housesOnly: false });
[chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Vorlage auf dieses Gebiet anwenden' }).click()]);
await chooser.setFiles({ name: 'west.vorlage.json', mimeType: 'application/json', buffer: Buffer.from(serializeTemplate(small)) });
await page.waitForSelector('.v5-markbar');
check('the template outline is in the editor, to be confirmed', /4\/50/.test(await page.locator('.v5-counter').first().innerText()) && /Vorlage geladen/.test(await page.locator('.v5-toast').innerText().catch(() => '')));
await page.getByRole('button', { name: 'Gebiet speichern' }).click();
await page.waitForFunction(() => !document.querySelector('.v5-markbar'), null, { timeout: 60000 });
check('after saving, progress outside the new outline is removed automatically and reported', await until(async () => /Markierungen außerhalb des neuen Umrisses entfernt/.test(await page.locator('.v5-toast').innerText().catch(() => '')), 30000));
const keys = await serverKeys();
check('only the east half was removed on the server', west.every((h) => keys.includes(h.key)) && east.every((h) => !keys.includes(h.key)), `${keys.length} rows left`);

// a new Area from a template
const east2 = makeTemplate('Ost-Vorlage', rect(700, 1300), { housesOnly: true });
await page.getByRole('button', { name: 'Schließen' }).click().catch(() => {});
[chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await openMenu(page); await page.getByRole('button', { name: 'Vorlage laden', exact: true }).click(); })()]);
await chooser.setFiles({ name: 'ost.vorlage.json', mimeType: 'application/json', buffer: Buffer.from(serializeTemplate(east2)) });
await page.waitForSelector('.v5-markbar');
check('a new Area starts from the template name', (await page.getByLabel('Name des Gebiets').inputValue()) === 'Ost-Vorlage');
await page.getByRole('button', { name: 'Gebiet speichern' }).click();
await page.waitForFunction(() => !document.querySelector('.v5-markbar'), null, { timeout: 60000 });
check('and exists on the server afterwards', await until(async () => (await page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/meta')).json()).areas.map((a) => a.name))).includes('Ost-Vorlage')));
check('the template rule "Nur Straßen mit Häusern" was applied to the map', await page.evaluate(() => !!window.__v5Map.getFilter('v5-segments-line')));
await page.screenshot({ path: `${process.env.SHOTS_DIR ?? '.'}/u5-template.png` });
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

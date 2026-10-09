// Aktions-Vorlage (whole map incl. Gruppen), preview and plan, automatic clean-up after reshaping, identity, location preselection, role-aware menu.
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

await page.getByRole('button', { name: 'Schließen' }).click();
await page.getByRole('button', { name: 'Fertig' }).click();

// export: the whole Aktion — every Gebiet and Gruppe — as one file
const [download] = await Promise.all([page.waitForEvent('download'), (async () => { await openMenu(page); await page.getByRole('button', { name: 'Als Vorlage', exact: true }).click(); })()]);
const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
check('the Aktions-Vorlage holds all Gebiete and all Gruppen, rules, and nothing else', exported.format === 'verteil-flyer-action-template' && exported.areas.length === 2 && exported.teams.length === 2 && Object.keys(exported).sort().join() === 'areas,format,name,rules,teams,version' && /\.aktion\.json$/.test(download.suggestedFilename()), `${download.suggestedFilename()} areas=${exported.areas?.length} teams=${exported.teams?.length}`);
check('each Gebiet names its Gruppe', exported.areas.every((a) => exported.teams.some((t) => t.name === a.team)));
const unchangedArea = exported.areas.find((a) => a.name === 'Fremdes Gebiet');

// a foreign file is refused in plain words
let [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await openMenu(page); await page.getByRole('button', { name: 'Vorlage laden', exact: true }).click(); })()]);
await chooser.setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') });
check('a foreign file is refused with a reason', await until(async () => /keine Vorlage/.test(await page.locator('.v5-toast').innerText().catch(() => '')), 5000));

// load a template: smaller outline for "Area", unchanged "Fremdes Gebiet", plus a new Gebiet in a new Gruppe
const template = makeTemplate('Frühjahr', [{ name: 'Team', color: '#2563eb' }, { name: 'Andere', color: '#ef4444' }, { name: 'Neues Team', color: '#15803d' }], [
  { name: 'Area', team: 'Team', ring: rect(-300, 650) },
  { name: 'Fremdes Gebiet', team: 'Andere', ring: unchangedArea.ring },
  { name: 'Ost-Vorlage', team: 'Neues Team', ring: rect(1400, 1500) },
], { housesOnly: true });
[chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await openMenu(page); await page.getByRole('button', { name: 'Vorlage laden', exact: true }).click(); })()]);
await chooser.setFiles({ name: 'fruehjahr.aktion.json', mimeType: 'application/json', buffer: Buffer.from(serializeTemplate(template)) });
await page.waitForSelector('.v5-sheet h2:has-text("Aktions-Vorlage")');
const planText = await page.locator('.v5-sheet').innerText();
check('the plan shows what would change before anything happens', /1 neue Gruppen/.test(planText) && /1 neue Gebiete/.test(planText) && /1 Gebiete mit neuem Umriss/.test(planText) && /1 unverändert/.test(planText) && /nichts gelöscht|Es wird nichts gelöscht/.test(planText), planText.replace(/\n/g, ' | ').slice(0, 300));
check('the template outlines are previewed on the map', await page.evaluate(() => window.__v5Map.getSource('v5-draw')._data.features.length === 3));
const beforeTeams = await page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/meta')).json()).teams.length);
check('nothing was created yet', beforeTeams === 2);
await page.screenshot({ path: `${process.env.SHOTS_DIR ?? '.'}/u5-template.png` });
await page.getByRole('button', { name: 'Anwenden' }).click();
check('applying reports what happened, incl. the automatic clean-up outside the new outline', await until(async () => /Vorlage angewendet: 1 Gruppen, 1 neue Gebiete, 1 angepasst, 5 Markierungen außerhalb entfernt/.test(await page.locator('.v5-toast').innerText().catch(() => '')), 90000), await page.locator('.v5-toast').innerText().catch(() => ''));
const after = await page.evaluate(async () => { const m = await (await fetch('/api/v5/campaigns/campaign_n/meta')).json(); return { teams: m.teams.map((t) => [t.name, t.color]), areas: m.areas.map((a) => [a.name, a.teamId]) , teamId: Object.fromEntries(m.teams.map((t) => [t.name, t.id])) }; });
check('the new Gruppe exists with its colour', after.teams.some(([n, c]) => n === 'Neues Team' && c === '#15803d'));
check('the new Gebiet belongs to the new Gruppe, the other Gebiete kept their Gruppe', after.areas.some(([n, t]) => n === 'Ost-Vorlage' && t === after.teamId['Neues Team']) && after.areas.some(([n, t]) => n === 'Area' && t === after.teamId['Team']) && after.areas.length === 3);
const keys = await serverKeys();
check('only the east half was removed on the server', west.every((h) => keys.includes(h.key)) && east.every((h) => !keys.includes(h.key)), `${keys.length} rows left`);
check('the template rule "Nur Straßen mit Häusern" was applied to the map', await page.evaluate(() => !!window.__v5Map.getFilter('v5-segments-line')));
// loading the same file again plans nothing: the application is idempotent
[chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => { await openMenu(page); await page.getByRole('button', { name: 'Vorlage laden', exact: true }).click(); })()]);
await chooser.setFiles({ name: 'fruehjahr.aktion.json', mimeType: 'application/json', buffer: Buffer.from(serializeTemplate(template)) });
await page.waitForSelector('.v5-sheet h2:has-text("Aktions-Vorlage")');
check('loading it again has nothing left to do', /Nichts zu tun/.test(await page.locator('.v5-sheet').innerText()) && (await page.getByRole('button', { name: 'Anwenden' }).count()) === 0);
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

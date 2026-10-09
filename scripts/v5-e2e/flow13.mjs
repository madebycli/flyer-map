// Gruppen: the admin creates, renames, recolours and deletes Gruppen, moves a Gebiet to another Gruppe, renames Gebiet and Aktion.
// Every change is checked against the server's truth, not against the screen.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const BASE = 'http://localhost:8140';
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(200); } return false; };
await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 120000 });
const meta = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/meta')).json()));

// Create a Gruppe
await menuTile(page, 'Gruppen');
await page.getByLabel('Name der neuen Gruppe').fill('Nord');
await page.getByRole('button', { name: '#e5736b' }).click();
await page.getByRole('button', { name: 'Gruppe anlegen' }).click();
check('a new Gruppe exists on the server with the chosen colour', await until(async () => (await meta()).teams.some((t) => t.name === 'Nord' && t.color === '#e5736b')));
check('the sheet lists it', await until(async () => (await page.getByLabel('Name der Gruppe Nord').count()) === 1));
await page.screenshot({ path: `${shots}/g1-groups.png` });

// Rename and recolour
const nord = async () => (await meta()).teams.find((t) => t.name === 'Nord' || t.name === 'Nordost');
await page.getByLabel('Name der Gruppe Nord').fill('Nordost');
await page.getByLabel('Name der Gruppe Nord').press('Enter');
check('renaming a Gruppe is saved', await until(async () => (await nord())?.name === 'Nordost'));
await page.getByRole('button', { name: 'Farbe von Nordost ändern' }).click();
await page.getByRole('group', { name: 'Farbe von Nordost' }).getByRole('button', { name: '#38b8a6' }).click();
check('recolouring a Gruppe is saved', await until(async () => (await nord())?.color === '#38b8a6'));

// A Gruppe with Gebieten cannot be deleted
const withAreas = (await meta()).teams.find((t) => (t.id === 'team_n'));
check('a Gruppe with Gebieten cannot be deleted from the sheet', await page.getByRole('button', { name: new RegExp(`Gruppe ${withAreas.name} löschen`) }).isDisabled());

// Delete the empty one (confirmation first)
page.once('dialog', (d) => { check('deleting asks first', /löschen/.test(d.message())); void d.accept(); });
await page.getByRole('button', { name: 'Gruppe Nordost löschen' }).click();
check('an empty Gruppe can be deleted', await until(async () => !(await meta()).teams.some((t) => t.name === 'Nordost')));

// Aktion rename
await page.getByLabel('Name der Aktion').fill('Frühjahr 2027');
await page.getByLabel('Name der Aktion').press('Enter');
check('the Aktion can be renamed', await until(async () => (await meta()).campaign.name === 'Frühjahr 2027'));
await page.getByRole('button', { name: 'Schließen' }).click();

// Gebiet: rename and move to the other Gruppe
await menuTile(page, 'Gebiete');
await page.waitForSelector('.v5-pill');
await page.evaluate(() => { const m = window.__v5Map; m.jumpTo({ center: [13 + 600 / 70053, 51 + 600 / 110574], zoom: 15 }); });
await page.waitForTimeout(800);
const tap = await page.evaluate(() => { const m = window.__v5Map; const p = m.project([13 + 600 / 70053, 51 + 600 / 110574]); return [p.x, p.y]; });
await page.mouse.click(tap[0], tap[1]);
await page.getByLabel('Name des Gebiets ändern').waitFor({ timeout: 10000 });
await page.getByLabel('Name des Gebiets ändern').fill('Mitte');
await page.getByLabel('Name des Gebiets ändern').press('Enter');
check('renaming a Gebiet is saved', await until(async () => (await meta()).areas.find((a) => a.id === 'area_n')?.name === 'Mitte'));
await page.getByRole('group', { name: 'Gruppe des Gebiets' }).getByRole('button', { name: /Zu Gruppe Andere/ }).click();
check('moving a Gebiet to another Gruppe is saved', await until(async () => (await meta()).areas.find((a) => a.id === 'area_n')?.teamId === 'team_o'));
await page.screenshot({ path: `${shots}/g2-area.png` });

// Delete the Gebiet: asks first, removes it and what v5 kept for it
await page.evaluate(async () => { await fetch('/api/v5/campaigns/campaign_n/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ id: `${(Date.now() - 1000).toString(36).padStart(11, '0')}-0000-seed`, key: 'h:gone-1', status: 'completed', area: 'area_n' }] }) }); });
page.once('dialog', (d) => { check('deleting a Gebiet asks first and says what goes with it', /Fortschritt, Notizen/.test(d.message())); void d.accept(); });
await page.getByRole('button', { name: 'Gebiet löschen' }).click();
check('the Gebiet is gone on the server', await until(async () => !(await meta()).areas.some((a) => a.id === 'area_n')));
check('and so is the progress that belonged to it', await until(async () => await page.evaluate(async () => !(await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.some((o) => o.area === 'area_n' && o.status !== 'open'))));
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

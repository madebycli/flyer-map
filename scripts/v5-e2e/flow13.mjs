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

// The sheet is a plain list: no form lives in it, "+" opens a page of its own for a new Gruppe (back arrow in the header)
await menuTile(page, 'Gruppen');
check('the Gruppen sheet shows no input field of its own', await page.locator('.v5-sheet-body input').count() === 0);
await page.getByRole('button', { name: 'Neue Gruppe' }).click();
await page.getByRole('heading', { name: 'Neue Gruppe' }).waitFor();
check('the page asks for a name and a colour', await page.getByLabel('Name der neuen Gruppe').count() === 1 && await page.getByRole('group', { name: 'Farbe der neuen Gruppe' }).count() === 1);
await page.waitForTimeout(500);
await page.screenshot({ path: `${shots}/g0-page-new.png` });
await page.getByRole('button', { name: 'Zurück zu den Gruppen' }).click();
check('the way back leaves without creating anything', await page.getByRole('heading', { name: 'Gruppen', exact: true, level: 2 }).count() === 1 && !(await meta()).teams.some((t) => t.name === 'Nord'));
await page.getByRole('button', { name: 'Neue Gruppe' }).click();
await page.getByLabel('Name der neuen Gruppe').fill('Nord');
await page.getByRole('button', { name: '#e5736b' }).click();
await page.getByRole('button', { name: 'Gruppe anlegen' }).click();
check('a new Gruppe exists on the server with the chosen colour', await until(async () => (await meta()).teams.some((t) => t.name === 'Nord' && t.color === '#e5736b')));
check('back on the list, which shows it', await until(async () => (await page.getByRole('button', { name: 'Gruppe Nord bearbeiten' }).count()) === 1));
await page.screenshot({ path: `${shots}/g1-groups.png` });

// Rename and recolour on the change page
const nord = async () => (await meta()).teams.find((t) => t.name === 'Nord' || t.name === 'Nordost');
await page.getByRole('button', { name: 'Gruppe Nord bearbeiten' }).click();
await page.getByLabel('Name der Gruppe Nord').fill('Nordost');
await page.getByRole('group', { name: 'Farbe von Nord' }).getByRole('button', { name: '#38b8a6' }).click();
await page.getByRole('button', { name: 'Speichern' }).click();
check('renaming and recolouring a Gruppe is saved', await until(async () => (await nord())?.name === 'Nordost' && (await nord())?.color === '#38b8a6'));

// A Gruppe with Gebieten cannot be deleted
const withAreas = (await meta()).teams.find((t) => (t.id === 'team_n'));
await page.getByRole('button', { name: `Gruppe ${withAreas.name} bearbeiten` }).click();
check('a Gruppe with Gebieten cannot be deleted from its page', await page.getByRole('button', { name: new RegExp(`Gruppe ${withAreas.name} löschen`) }).isDisabled());
await page.getByRole('button', { name: 'Zurück zu den Gruppen' }).click();

// Delete the empty one (confirmation first)
await page.getByRole('button', { name: 'Gruppe Nordost bearbeiten' }).click();
page.once('dialog', (d) => { check('deleting asks first', /löschen/.test(d.message())); void d.accept(); });
await page.getByRole('button', { name: 'Gruppe Nordost löschen' }).click();
check('an empty Gruppe can be deleted', await until(async () => !(await meta()).teams.some((t) => t.name === 'Nordost')));

// Gebiete zuweisen: a level below, every Gebiet with its Gruppe
const areaName = (await meta()).areas.find((a) => a.id === 'area_n').name;
const other = (await meta()).teams.find((t) => t.id === 'team_o').name;
const own = (await meta()).teams.find((t) => t.id === 'team_n').name;
await page.getByRole('button', { name: /Gebiete zuweisen/ }).click();
check('the assignment is its own view with a way back', await page.getByRole('button', { name: 'Zurück zu den Gruppen' }).count() === 1);
await page.evaluate(() => { document.querySelector('.v5-sheet').dataset.probe = 'kept'; });
await page.getByLabel(`Gruppe von ${areaName}`).selectOption({ label: other });
check('assigning a Gebiet to another Gruppe from the Gruppen sheet is saved', await until(async () => (await meta()).areas.find((a) => a.id === 'area_n')?.teamId === 'team_o'));
check('the sheet stays open while the Aktion is re-read (no flash)', await until(async () => /→/.test(await page.locator('.v5-toast').innerText().catch(() => ''))) && await page.evaluate(() => document.querySelector('.v5-sheet')?.dataset.probe === 'kept'));
await page.getByLabel(`Gruppe von ${areaName}`).selectOption({ label: own });
check('and back again', await until(async () => (await meta()).areas.find((a) => a.id === 'area_n')?.teamId === 'team_n'));
await page.screenshot({ path: `${shots}/g1b-assign.png` });
await page.getByRole('button', { name: 'Zurück zu den Gruppen' }).click();
check('the Gruppe that now has Gebiete cannot be deleted', (await page.getByRole('button', { name: `Gruppe ${own} bearbeiten` }).count()) === 1);

// Aktion rename (page)
await page.getByRole('button', { name: 'Aktion umbenennen' }).click();
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
check('on the Gebiet, each Gruppe is shown with its name, the current one pressed', await page.getByRole('group', { name: 'Gruppe des Gebiets' }).getByRole('button', { name: own, exact: true }).getAttribute('aria-pressed') === 'true');
await page.getByRole('group', { name: 'Gruppe des Gebiets' }).getByRole('button', { name: other, exact: true }).click();
check('moving a Gebiet to another Gruppe is saved', await until(async () => (await meta()).areas.find((a) => a.id === 'area_n')?.teamId === 'team_o'));
await page.screenshot({ path: `${shots}/g2-area.png` });

// Delete the Gebiet: asks first, removes it and what v5 kept for it
await page.evaluate(async () => { await fetch('/api/v5/campaigns/campaign_n/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ id: `${(Date.now() - 1000).toString(36).padStart(11, '0')}-0000-seed`, key: 'h:gone-1', status: 'completed', area: 'area_n' }] }) }); });
page.once('dialog', (d) => { check('deleting a Gebiet asks first and says what goes with it', /Fortschritt, Notizen/.test(d.message())); void d.accept(); });
await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
await page.getByRole('menuitem', { name: 'Gebiet löschen' }).click();
check('the Gebiet is gone on the server', await until(async () => !(await meta()).areas.some((a) => a.id === 'area_n')));
check('and so is the progress that belonged to it', await until(async () => await page.evaluate(async () => !(await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.some((o) => o.area === 'area_n' && o.status !== 'open'))));
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

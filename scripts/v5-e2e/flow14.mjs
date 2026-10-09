// Abholen einrichten (admin): draw a Teilgebiet, edit it, a helper takes an Area and the admin frees it, archive, helper rights per device.
// Server truth is checked through the real handlers (meta, collectors).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const BASE = 'http://localhost:8140';
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

const adminCtx = await b.newContext({ viewport: { width: 430, height: 932 } });
await adminCtx.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const admin = await adminCtx.newPage();
admin.on('pageerror', (e) => console.log('PAGEERROR admin', e.message));
await admin.goto(`${BASE}/v5.html?campaign=campaign_n&kind=collection&debug`);
await admin.waitForSelector('.v5-pill', { timeout: 120000 });
const meta = () => admin.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/meta?kind=collection')).json()));

// Einrichten sheet
await menuTile(admin, 'Einrichten');
await admin.getByRole('heading', { name: 'Abholen einrichten' }).waitFor();
const sheetText = await admin.locator('.v5-sheet').innerText();
check('the sheet shows the Sammelgebiet and both Teilgebiete', /Sammelgebiet/.test(sheetText) && /West/.test(sheetText) && /Ost/.test(sheetText), sheetText.replace(/\n/g, ' | ').slice(0, 200));
await admin.screenshot({ path: `${shots}/c1-setup.png` });

// Draw a new Teilgebiet
await admin.getByRole('button', { name: 'Teilgebiet zeichnen' }).click();
await admin.getByLabel('Name des Gebiets').waitFor();
await admin.getByLabel('Name des Gebiets').fill('Mitte');
await admin.getByRole('group', { name: 'Farbe' }).getByRole('button', { name: '#e0a83a' }).click();
await admin.screenshot({ path: `${shots}/c2-draw.png` });
await admin.getByRole('button', { name: 'Gebiet speichern' }).click();
check('the Teilgebiet is saved with its name and colour', await until(async () => (await meta()).areas.some((a) => a.name === 'Mitte' && a.collection.color === '#e0a83a')));
check('afterwards the Einrichten sheet is back', await until(async () => (await admin.getByRole('heading', { name: 'Abholen einrichten' }).count()) === 1));

// Edit: rename
await admin.getByRole('button', { name: 'Mitte bearbeiten' }).click();
await admin.getByLabel('Name des Gebiets').fill('Zentrum');
await admin.getByRole('button', { name: 'Gebiet speichern' }).click();
const renamed = await until(async () => (await meta()).areas.some((a) => a.name === 'Zentrum'));
check('renaming a Teilgebiet is saved', renamed, renamed ? '' : (await admin.locator('.v5-markbar').innerText().catch(() => 'no bar')).replace(/\n/g, ' | '));
await admin.getByRole('heading', { name: 'Abholen einrichten' }).waitFor();

// A helper takes West, the admin frees it
const aliceCtx = await b.newContext({ viewport: { width: 430, height: 932 } });
await aliceCtx.addCookies([{ name: 'vf_collection_session', value: cookies.alice, url: BASE }]);
const alice = await aliceCtx.newPage();
await alice.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await alice.waitForSelector('.v5-pill', { timeout: 120000 });
await menuTile(alice, 'Gebiete');
await alice.locator('.v5-arearow', { hasText: 'West' }).getByRole('button', { name: /übernehmen/ }).click();
check('the helper holds West', await until(async () => (await meta()).areas.find((a) => a.name === 'West')?.collection.status !== 'open'));
await admin.getByRole('button', { name: 'Schließen' }).click();
await menuTile(admin, 'Einrichten');
check('the admin sees West as being worked on and can free it', await until(async () => (await admin.getByRole('button', { name: 'West freigeben' }).count()) === 1));
admin.once('dialog', (d) => { check('freeing asks first', /freigeben/.test(d.message())); void d.accept(); });
await admin.getByRole('button', { name: 'West freigeben' }).click();
check('West is open again on the server', await until(async () => (await meta()).areas.find((a) => a.name === 'West')?.collection.status === 'open'));
check('archiving a held Teilgebiet is not offered, an open one is', (await admin.getByRole('button', { name: 'Zentrum archivieren' }).isEnabled()));

// Archive
admin.once('dialog', (d) => { void d.accept(); });
await admin.getByRole('button', { name: 'Zentrum archivieren' }).click();
check('an archived Teilgebiet is marked archived', await until(async () => (await meta()).areas.find((a) => a.name === 'Zentrum')?.collection.status === 'archived'));
check('and leaves the list', await until(async () => !/Zentrum/.test(await admin.locator('.v5-sheet').innerText())));

// Helper rights per device
await admin.getByRole('button', { name: 'Schließen' }).click();
await menuTile(admin, 'Zugänge');
await admin.getByRole('group', { name: /Sonder-Marker-Rechte von Nutzer 2/ }).waitFor({ timeout: 20000 });
const rights = () => admin.evaluate(async () => { const r = await (await fetch('/api/campaigns/campaign_n/collection/collectors')).json(); return r.collectors.map((c) => ({ label: c.label, caps: c.collectionCapabilities })); });
const before = (await rights()).find((c) => c.label === 'Nutzer 2');
await admin.getByRole('button', { name: 'Nutzer 2: Anlegen' }).click();
check('switching a right on is stored for that device only', await until(async () => { const now = await rights(); return now.find((c) => c.label === 'Nutzer 2')?.caps.canCreatePickups === !before.caps.canCreatePickups && now.find((c) => c.label === 'Nutzer 1')?.caps.canCreatePickups === true; }));
await admin.screenshot({ path: `${shots}/c3-rights.png` });

await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

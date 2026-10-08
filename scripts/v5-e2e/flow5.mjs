// Field notes: quick flags + text on a house, map markers, sync to a second person, overview, read-only viewer.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const until = async (predicate, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

async function person(who) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addCookies([{ name: 'vf_session', value: cookies[who], url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', who, e.message));
  const gate = { blocked: false };
  await page.route('**/api/**', (route) => (gate.blocked ? route.abort() : route.continue()));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 4000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getSource('v5-houses') && window.__v5Map.getSource('v5-notes'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const jump = (x, y, z) => page.evaluate(async ([c, zoom]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), z]);
  const click = async (x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
  const markers = () => page.evaluate(() => window.__v5Map.getSource('v5-notes')._data?.features?.length ?? 0);
  const serverNotes = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/notes?since=0')).json()).notes);
  return { ctx, page, gate, jump, click, markers, serverNotes };
}

const A = await person('admin');
await A.jump(116, 13, 18.1);
await A.click(116, 13);
await A.page.waitForSelector('.v5-sheet');
check('the sheet offers seven quick flags and a text field', (await A.page.locator('.v5-flag').count()) === 7 && (await A.page.getByLabel('Notiz', { exact: true }).count()) >= 1);

// One tap on a flag is a note; tapping again takes it back.
await A.page.getByRole('button', { name: 'Hund', exact: true }).click();
check('a flag tap creates a note at once', (await A.page.locator('.v5-note').count()) === 1);
await A.page.getByRole('button', { name: 'Hund', exact: true }).click();
check('tapping the same flag again removes it', (await A.page.locator('.v5-note').count()) === 0);
await A.page.getByRole('button', { name: 'Hund', exact: true }).click();

// Text first, then a flag: both in one note.
await A.page.getByLabel('Notiz', { exact: true }).fill('Klingel kaputt, bitte klopfen');
await A.page.getByRole('button', { name: 'Kein Zutritt', exact: true }).click();
check('text plus flag make one note', (await A.page.locator('.v5-note').count()) === 2 && /Klingel kaputt/.test(await A.page.locator('.v5-note').last().innerText()));
await A.page.getByLabel('Notiz', { exact: true }).fill('Zweite Notiz nur Text');
await A.page.getByRole('button', { name: 'Notiz speichern' }).click();
check('a text-only note is stored', (await A.page.locator('.v5-note').count()) === 3);
await A.page.screenshot({ path: `${process.env.SHOTS_DIR ?? '.'}/f5-notes-sheet.png` });
check('one marker per annotated place, not per note', await until(async () => (await A.markers()) === 1));
check('notes reach the server', await until(async () => (await A.serverNotes()).filter((n) => !n.deleted).length === 3));

// The marker is tappable and opens the same place.
await A.page.getByRole('button', { name: 'Schließen' }).click();
await A.page.waitForTimeout(300);
await A.click(100, 40); // elsewhere: nothing selected
await A.jump(116, 13, 18.1);
const pin = await A.page.evaluate(() => { const f = window.__v5Map.getSource('v5-notes')._data.features[0]; const p = window.__v5Map.project(f.geometry.coordinates); return [p.x, p.y]; });
await A.page.mouse.click(pin[0], pin[1]);
check('tapping the marker opens its notes', await until(async () => (await A.page.locator('.v5-note').count()) === 3, 4000));
await A.page.getByRole('button', { name: 'Schließen' }).click();

// Second person sees them; delete is an edit that propagates.
const B = await person('editor');
check('another person receives the marker', await until(async () => (await B.markers()) === 1));
B.gate.blocked = true;
await B.jump(136, 13, 18.1); await B.click(136, 13);
await B.page.waitForSelector('.v5-sheet');
await B.page.getByRole('button', { name: 'Gefahr', exact: true }).click();
check('offline: the note exists locally and is queued', (await B.page.locator('.v5-note').count()) === 1 && (await B.serverNotes().catch(() => null)) === null);
B.gate.blocked = false;
await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
check('after reconnect it reaches the server', await until(async () => (await A.serverNotes()).some((n) => n.flag === 'danger')));
await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
check('and the first person’s map shows the second marker', await until(async () => (await A.markers()) === 2));

// Overview from the menu.
await A.page.getByRole('button', { name: 'Mehr' }).click();
await A.page.getByRole('button', { name: /^Notizen/ }).click();
check('the overview lists all notes', await until(async () => (await A.page.locator('.v5-note-open').count()) === 4, 4000));
await A.page.getByRole('button', { name: 'Gefahr (1)' }).click();
check('the filter narrows the list', (await A.page.locator('.v5-note-open').count()) === 1);
await A.page.screenshot({ path: `${process.env.SHOTS_DIR ?? '.'}/f5-notes-overview.png` });
await A.page.locator('.v5-note-open').first().click();
check('tapping a row opens that place', await until(async () => /Gefahr/.test(await A.page.locator('.v5-sheet').innerText()) , 4000));

// Delete with undo.
await A.page.getByRole('button', { name: 'Notiz löschen' }).first().click();
check('deleting offers undo', (await A.page.getByRole('button', { name: 'Rückgängig' }).count()) === 1);
await A.page.getByRole('button', { name: 'Rückgängig' }).click();
check('undo brings the note back', (await A.page.locator('.v5-note').count()) === 1);
check('and the restore reaches the server', await until(async () => (await A.serverNotes()).filter((n) => !n.deleted).length === 4));
await A.ctx.close(); await B.ctx.close();

// Viewer: sees notes, cannot write.
const V = await person('viewer');
check('a viewer sees the markers', await until(async () => (await V.markers()) === 2));
await V.jump(116, 13, 18.1); await V.click(116, 13);
await V.page.waitForSelector('.v5-sheet');
check('but gets no flags and no text field', (await V.page.locator('.v5-flag').count()) === 0 && (await V.page.locator('.v5-note-form').count()) === 0 && (await V.page.locator('.v5-note').count()) === 3);
await V.ctx.close(); await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

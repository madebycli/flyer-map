// Räume (runs) of a distribution Aktion: a Gruppe opens a room with a hand-made headcount, a guest joins with the link and is bound to the Gebiet,
// the headcount does not follow devices, the room ends with the guest's access, the record shows time/people/houses, and the Aktion's time window
// counts down. Two browsers: the admin and a guest without any access.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile, openMenu } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const ready = async (page) => {
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 180000 });
  await page.waitForTimeout(800);
};
const settle = (page) => page.locator('.v5-sheet').evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });

const adminCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
await adminCtx.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const admin = await adminCtx.newPage();
admin.on('pageerror', (error) => check(`admin page error ${error.message}`, false));
await admin.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await ready(admin);
const rooms = () => admin.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/rooms')).json()).rooms);

// ── opening a room ─────────────────────────────────────────────
await menuTile(admin, 'Runs');
await admin.getByRole('button', { name: 'Raum öffnen', exact: true }).click();
await admin.getByRole('group', { name: 'Wer darf beitreten' }).waitFor();
await settle(admin);
const start = admin.locator('.v5-sheet').getByRole('button', { name: 'Raum öffnen', exact: true });
check('the number of people is required: no start without it', await start.isDisabled());
check('joining by link or QR code is the default', (await admin.getByRole('button', { name: 'Link / QR' }).getAttribute('aria-pressed')) === 'true');
await admin.screenshot({ path: `${shots}/t22-start.png` });
await admin.getByRole('textbox', { name: 'Personenzahl' }).fill('12');
check('with a number the room can be opened', await until(async () => !(await start.isDisabled())));
await start.click();
await admin.getByRole('timer', { name: 'Laufzeit des Raums' }).waitFor();
await settle(admin);
const open1 = (await rooms())[0];
check('the room is open for the Gebiet with 12 people and link joining', open1 && open1.status === 'active' && open1.headcount === 12 && open1.joinMode === 'link' && !!open1.joinSecret, JSON.stringify(open1));
const link = await admin.getByRole('textbox', { name: 'Beitrittslink' }).inputValue();
check('the link has the room in the address and the secret in the fragment', /\/v5\?campaign=campaign_n&room=room_/.test(link) && /#j=/.test(link), link);
check('a QR code is shown', (await admin.locator('.v5-qr svg').count()) === 1);
await admin.screenshot({ path: `${shots}/t22-room.png` });

// ── a guest joins ──────────────────────────────────────────────
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guest = await guestCtx.newPage();
guest.on('pageerror', (error) => check(`guest page error ${error.message}`, false));
await guest.goto(link);
await guest.getByRole('heading', { name: 'Raum beitreten' }).waitFor();
check('the join page names the Gebiet and asks for a name only', (await guest.locator('.v5-join').innerText()).includes('Area') && (await guest.getByLabel('Passwort').count()) === 0);
await guest.screenshot({ path: `${shots}/t22-join.png` });
await guest.getByLabel('Dein Name').fill('Anna');
await guest.getByRole('button', { name: 'Beitreten' }).click();
await guest.waitForSelector('.v5-pill', { timeout: 120000 });
check('the guest lands in the app, which shows the running room', await until(async () => (await guest.locator('.v5-roomchip').count()) === 1));
await guest.waitForFunction(() => window.__v5Map || true);
const guestMeta = await guest.evaluate(async () => (await fetch('/api/v5/campaigns/campaign_n/meta')).json());
check('the guest works as the Gruppe, in the room’s Gebiet only', guestMeta.role === 'team-editor' && !!guestMeta.guestRoom && guestMeta.areas.length === 1 && guestMeta.areas[0].writable, JSON.stringify([guestMeta.role, guestMeta.areas.length]));
await menuTile(guest, 'Runs');
check('a guest cannot open rooms or end them', (await guest.getByRole('button', { name: 'Raum öffnen', exact: true }).count()) === 0);
await guest.getByRole('button', { name: /^Raum Area öffnen/ }).click();
check('he sees the clock and the people', (await guest.getByRole('timer').count()) === 1 && (await guest.getByRole('textbox', { name: 'Personenzahl' }).inputValue()) === '12');
check('and cannot end the run', (await guest.getByRole('button', { name: 'Run beenden' }).count()) === 0);
await guest.screenshot({ path: `${shots}/t22-guest-room.png` });

// ── the headcount is by hand: a second device changes nothing ──
const guest2Ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const guest2 = await guest2Ctx.newPage();
await guest2.goto(link);
await guest2.getByRole('button', { name: 'Beitreten' }).click();
await guest2.waitForSelector('.v5-pill', { timeout: 120000 });
check('a further device joins and the headcount stays what was entered (12)', (await rooms())[0].headcount === 12);
await admin.getByRole('button', { name: 'Eine Person mehr' }).click();
await admin.getByRole('button', { name: 'Eine Person mehr' }).click();
check('the number is changed by hand only (14), debounced into one change', await until(async () => (await rooms())[0].headcount === 14));
await guest2Ctx.close();

// ── ending the run ─────────────────────────────────────────────
admin.once('dialog', (d) => { check('ending asks first and says what happens to the guests', /Gäste/.test(d.message())); void d.accept(); });
await admin.getByRole('button', { name: 'Run beenden' }).click();
await admin.getByText('Run beendet').waitFor();
await settle(admin);
const summary = await admin.locator('.v5-summary').innerText();
check('the result shows time, people, houses and the share of the Gebiet', /Zeit/.test(summary) && /14/.test(summary) && /Personen/.test(summary) && /Häuser/.test(summary) && /vom Gebiet/.test(summary), summary.replace(/\n/g, ' | '));
await admin.screenshot({ path: `${shots}/t22-summary.png` });
const done = (await rooms())[0];
check('the room is finished on the server', done.status === 'finished' && !!done.endedAt && done.headcount === 14 && !done.joinSecret);
check('the guest’s access ended with the room', await until(async () => (await guest.evaluate(async () => (await fetch('/api/v5/campaigns/campaign_n/meta')).status)) === 401, 20000));
await guest.goto(link);
check('opening the link again shows that the room is over', await guest.getByRole('heading', { name: 'Raum beendet' }).isVisible().catch(() => false));
await guestCtx.close();

// ── the record ─────────────────────────────────────────────────
await admin.getByRole('button', { name: 'Fertig' }).click();
await admin.locator('.v5-sheet').getByText('Alle Runs').waitFor();
await settle(admin);
const runs = await admin.locator('.v5-sheet').innerText();
check('the Runs sheet lists the finished run with figures and the totals', /1 Run/.test(runs) && /Area/.test(runs) && /vom Gebiet/.test(runs) && /je Person und Std/.test(runs), runs.replace(/\n/g, ' | ').slice(0, 300));
await admin.screenshot({ path: `${shots}/t22-runs.png` });

// ── the time window ────────────────────────────────────────────
const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000 + 3 * 3_600_000), weekAgo = new Date(Date.now() - 7 * 86_400_000);
// the window is set when the Aktion is created (organiser pages, flow 11), not in the Runs sheet: here it is set through the API and read back
check('the Runs sheet has no time-window form', (await admin.getByLabel('Start des Zeitfensters').count()) === 0);
await admin.evaluate(async ([s, e]) => { await fetch('/api/v5/campaigns/campaign_n/window', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ startsAt: s, endsAt: e }) }); }, [weekAgo.toISOString(), inTwoWeeks.toISOString()]);
await admin.reload();
await admin.waitForSelector('.v5-pill', { timeout: 120000 });
await menuTile(admin, 'Runs');
check('the countdown appears with days and hours', await until(async () => /Noch 14 Tage/.test(await admin.locator('.v5-countdown').innerText().catch(() => '')), 10000), await admin.locator('.v5-countdown').innerText().catch(() => ''));
await settle(admin);
await admin.screenshot({ path: `${shots}/t22-window.png` });
await admin.getByRole('button', { name: 'Schließen' }).click();
await menuTile(admin, 'Übersicht');
await admin.locator('.v5-countdown').waitFor();
check('the overview shows it too, with time against progress', /Noch 14 Tage/.test(await admin.locator('.v5-countdown').innerText()) && /der Zeit/.test(await admin.locator('.v5-countdown').innerText()));
await admin.getByRole('button', { name: 'Schließen' }).click();
await openMenu(admin);
check('and the menu names the time left', /Noch 14 Tage/.test(await admin.locator('.v5-sheet').innerText()));
await admin.getByRole('button', { name: 'Schließen' }).click();

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

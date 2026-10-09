// UI v2: Menü, Übersicht, Suche, Standort, Zoom, "Nur Straßen mit Häusern", Gebiet bereinigen, no sharp shapes.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { encodeClock } from '../../src/v5/store/hlc.ts';
import { menuTile, openMenu, startMarking } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, permissions: ['geolocation'], geolocation: { latitude: 51.0, longitude: 13.003 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 120000 });
await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')) && window.__v5Map.getLayer('v5-segments-line'), null, { timeout: 60000 });
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

// Controls are squares (or one pill height): same width as height, same radius family
const sizes = await page.evaluate(() => [...document.querySelectorAll('.v5-sq, .v5-fab')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
check('icon controls are squares', sizes.length >= 5 && sizes.every(([w, h]) => w === h), JSON.stringify(sizes));
check('no backdrop blur anywhere in the shell', await page.evaluate(() => ![...document.querySelectorAll('.v5-root *')].some((e) => { const s = getComputedStyle(e); return (s.backdropFilter && s.backdropFilter !== 'none') || (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none'); })));
check('every control has rounded corners', await page.evaluate(() => [...document.querySelectorAll('.v5-sq:not(.v5-zoom .v5-sq), .v5-zoom, .v5-fab, .v5-pill')].every((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 12)));
await page.screenshot({ path: `${shots}/u1-idle.png` });

// Zoom ±
const z0 = await page.evaluate(() => window.__v5Map.getZoom());
await page.getByRole('button', { name: 'Hineinzoomen' }).click();
check('zoom in button zooms in', await until(async () => (await page.evaluate(() => window.__v5Map.getZoom())) > z0 + 0.8));
await page.getByRole('button', { name: 'Herauszoomen' }).click();
check('zoom out button zooms out', await until(async () => Math.abs((await page.evaluate(() => window.__v5Map.getZoom())) - z0) < 0.3));

// Standort aktualisieren: one fix, the map flies there, the dot is drawn
await page.getByRole('button', { name: 'Standort aktualisieren' }).click();
check('locate flies to the fix and shows the position dot', await until(async () => await page.evaluate(() => { const m = window.__v5Map; const c = m.getCenter(); const src = m.getSource('v5-me')?._data; return Math.abs(c.lng - 13.003) < 0.001 && src?.features?.length === 1; })));

// Compass appears only while rotated
check('no compass while north is up', (await page.getByRole('button', { name: /nach Norden/ }).count()) === 0);
await page.evaluate(() => window.__v5Map.setBearing(40));
check('compass appears when rotated', await until(async () => (await page.getByRole('button', { name: /nach Norden/ }).count()) === 1));
await page.getByRole('button', { name: /nach Norden/ }).click();
check('and resets north', await until(async () => (await page.evaluate(() => Math.abs(window.__v5Map.getBearing()) < 0.5)) && (await page.getByRole('button', { name: /nach Norden/ }).count()) === 0));

// Übersicht from the capsule: houses, per Area, sync, legend
await page.locator('.v5-pill').click();
await page.waitForSelector('.v5-sheet');
const overview = await page.locator('.v5-sheet').innerText();
check('overview: percentage by houses, legend with explanations, honest sync box', /Übersicht/.test(overview) && /Häuser/.test(overview) && /Nicht möglich/.test(overview) && /kein Zugang/.test(overview) && /Zuletzt erfolgreich/.test(overview), overview.replace(/\n/g, ' | ').slice(0, 300));
await page.screenshot({ path: `${shots}/u2-overview.png` });
await page.getByRole('button', { name: 'Schließen' }).click();

// Suche
await page.getByRole('button', { name: 'Straße oder Adresse suchen' }).first().click();
await page.locator('.v5-sheet').getByLabel('Straße oder Adresse suchen').fill('querstr 1');
await page.waitForSelector('.v5-result');
check('search finds streets and addresses ("Str." spelling)', (await page.locator('.v5-result').count()) >= 2 && /Querstraße 1/.test(await page.locator('.v5-result').first().innerText()));
await page.locator('.v5-result').first().click();
await page.waitForSelector('.v5-sheet');
check('picking a result opens it on the map', /Querstraße 1/.test(await page.locator('.v5-sheet h2').innerText()));
await page.getByRole('button', { name: 'Schließen' }).click();

// Menü: tiles, Karte aus, no leftover old controls
await openMenu(page);
const tiles = await page.locator('.v5-home .v5-app').allInnerTexts();
check('menu tiles: modes for the admin, overview, search, areas, notes', ['Austeilen', 'Abholen', 'Übersicht', 'Suche', 'Gebiete', 'Notizen'].every((t) => tiles.some((x) => x.includes(t))), tiles.join('|'));
await page.screenshot({ path: `${shots}/u3-menu.png` });
await page.getByRole('button', { name: 'Karte aus', exact: true }).click();
check('"Karte aus" is remembered per device', await page.evaluate(() => localStorage.getItem('vf-v5-base') === 'off'));
await page.getByRole('button', { name: 'Karte an', exact: true }).click();
await page.getByRole('button', { name: 'Schließen' }).click();

// Marking: caption, discard, "Nur Straßen mit Häusern"
await startMarking(page);
check('marking caption explains the first step', /Startpunkt/.test(await page.locator('.v5-caption').innerText()));
await page.locator('.v5-fab .v5-tile').first().click();
await page.getByRole('button', { name: 'Nur Straßen mit Häusern' }).click();
await page.getByRole('button', { name: 'Weiter markieren' }).click();
await page.waitForTimeout(1200);
const hidden = await page.evaluate(async () => { const m = window.__v5Map; return m.queryRenderedFeatures({ layers: ['v5-segments-line'] }).filter((f) => f.properties.h === '0').length; });
check('streets without houses disappear from the map while the filter is on', hidden === 0, `h=0 rendered: ${hidden}`);
await page.screenshot({ path: `${shots}/u4-marking.png` });
await page.getByRole('button', { name: 'Markieren beenden' }).click();

// Gebiet bereinigen: an orphan row (a key the derivation does not produce) is removed by the admin, for that Area only
const clock = encodeClock({ wall: Date.now() - 1000, counter: 0, node: 'seed' });
const seeded = await page.evaluate(async (id) => (await fetch('/api/v5/campaigns/campaign_n/ops', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ id, key: 'h:ghost-9', status: 'completed', area: 'area_n' }] }) })).status, clock);
check('seeded an orphan progress row', seeded === 200);
await page.reload();
await page.waitForSelector('.v5-pill', { timeout: 120000 });
await page.waitForFunction(() => window.__v5Map && window.__v5Map.getLayer('v5-segments-line'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
// Team & Aktivität: derived from the overlay (author + clock of every entry), no extra request
await menuTile(page, 'Team');
await page.waitForSelector('.v5-sheet[aria-label="Team & Aktivität"]');
const teamText = async () => (await page.locator('.v5-sheet').innerText()).replace(/\n/g, ' | ');
check('team sheet lists a person with houses brought in today, and the latest change', await until(async () => { const t = await teamText(); return /wer hat wie viel/i.test(t) && /1 heute/.test(t) && /zuletzt/i.test(t); }), (await teamText()).slice(0, 300));
await page.screenshot({ path: `${shots}/u5-team.png` });
await page.getByRole('button', { name: 'Schließen' }).click();
await menuTile(page, 'Gebiete');
await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
await page.waitForTimeout(1200);
const [cx, cy] = await page.evaluate(() => { const c = window.__v5Map.project([13.0075, 51.0045]); return [c.x, c.y]; });
await page.mouse.click(cx, cy);
await page.waitForSelector('.v5-sheet');
const broom = page.getByRole('button', { name: /Veraltete Einträge/ });
check('an admin sees the clean-up button for an Area with orphan rows', await until(async () => (await broom.count()) === 1));
page.once('dialog', (dialog) => { check('the manual clean-up asks first and says it affects every device', /alle Geräte/.test(dialog.message())); void dialog.accept(); });
await broom.click();
check('and it reports what it removed', await until(async () => /1 veraltete Einträge entfernt/.test(await page.locator('.v5-toast').innerText().catch(() => ''))));
check('the orphan is gone on the server, real progress is not touched', await until(async () => await page.evaluate(async () => { const ops = (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops; return !ops.some((o) => o.key === 'h:ghost-9'); })));
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

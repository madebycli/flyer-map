// Fast marking tools and the Area editor, against the real handlers (v5 API + legacy mutation endpoint).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { confirmRoute, menuTile, setBrush, setMode, startMarking } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const boot = async () => {
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug' + (process.env.V5_QUERY ?? ''));
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const done = async () => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const jump = (x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const scr = (x, y) => page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y));
const clickAt = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.click(sx, sy); };
const serverStatus = (key) => page.evaluate(async (k) => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.find((o) => o.key === k)?.status ?? 'open', key);
const until = async (predicate, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const drag = async (points) => { const first = await scr(...points[0]); await page.mouse.move(...first); await page.mouse.down(); for (const p of points.slice(1)) { const [sx, sy] = await scr(...p); await page.mouse.move(sx, sy, { steps: 14 }); } await page.mouse.up(); };

await boot();
const start = await done();
check('boots', start === 0, `done=${start}`);

// ── tap mode: one tap = one house, brush chosen once ──────────────
await startMarking(page);
await setMode(page, 'Tippen');
await jump(116, 13, 18.1);
await clickAt(116, 13);
await page.waitForTimeout(500);
check('tap stamps a house with the default brush (Ausgeteilt) in a single tap', (await done()) === 1);
await page.locator('.v5-fab').getByRole('button', { name: /^Pinsel: Ausgeteilt/ }).click(); // the panel's brush tile cycles to the next status
await clickAt(136, 13);
await page.waitForTimeout(400);
check('switching the brush once changes what every following tap does', (await done()) === 1 && (await until(() => serverStatus('h:h5000098').then((s) => s === 'later'))));

// ── paint mode: one drag over a row of houses ─────────────────────
await setBrush(page, 'Ausgeteilt');
await setMode(page, 'Wischen');
await jump(246, 13, 18.1);
const before = await done();
await drag([[213, 13], [273, 13]]);
await page.waitForTimeout(600);
const painted = (await done()) - before;
check('painting across four houses marks exactly those four', painted === 4, `+${painted}`);
await page.screenshot({ path: `${shots}/t1-paint.png` });

// ── lasso: circle a whole block ───────────────────────────────────
await setMode(page, 'Lasso');
await jump(350, 50, 17.2);
const lassoBefore = await done();
await drag([[302, 2], [398, 2], [398, 98], [302, 98], [302, 2]]);
await page.waitForTimeout(700);
const lassoed = (await done()) - lassoBefore;
check('lasso marks the houses of the circled block (8) and nothing outside', lassoed === 8, `+${lassoed}`);
await page.screenshot({ path: `${shots}/t2-lasso.png` });

// ── route: tap points, confirm with the check, pick the status ─────
await setMode(page, 'Strecke');
await jump(200, 0, 15.8);
await clickAt(50, 0); await clickAt(350, 0);
await page.waitForTimeout(700);
check('the counter tile counts the tapped points', (await page.locator('.v5-fab .v5-tile b').first().innerText()) === '2');
const routeBefore = await done();
await confirmRoute(page);
await page.waitForTimeout(900);
check('a route is two taps, a check and a status', (await done()) > routeBefore, `+${(await done()) - routeBefore}`);
check('after a route the panel is ready for the next one (points reset)', (await page.locator('.v5-fab .v5-tile b').first().innerText()) === '0');

// ── "Nur Straßen mit Häusern" is a switch in the options and filters the map layers ──
await page.locator('.v5-fab .v5-tile').first().click();
await page.getByRole('button', { name: 'Nur Straßen mit Häusern' }).click();
check('the filter reaches the street layers', await page.evaluate(() => JSON.stringify(window.__v5Map.getFilter('v5-segments-line') ?? null).includes('"h"')));
await page.getByRole('button', { name: 'Nur Straßen mit Häusern' }).click();
check('and can be switched off again', await page.evaluate(() => !window.__v5Map.getFilter('v5-segments-line')));
await page.getByRole('button', { name: 'Weiter markieren' }).click();

await page.getByRole('button', { name: 'Markieren beenden' }).click();
check('closing the tool brings the marking button back', await page.getByRole('button', { name: 'Markieren starten' }).isVisible());
check('every gesture reached the server', await until(async () => (await serverStatus('h:h5000192')) === 'completed' && (await serverStatus('h:h5000290')) === 'completed'));

// ── Area editor ───────────────────────────────────────────────────
const areaRing = async () => page.evaluate(async () => { const m = await (await fetch('/api/v5/campaigns/campaign_n/meta')).json(); const a = m.areas.find((x) => x.id === 'area_n'); return { ring: a.geometry.coordinates[0], updatedAt: a.updatedAt, packVersion: a.packVersion, count: m.areas.length }; });
const originalArea = await areaRing();
await menuTile(page, 'Gebiete');
await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
await page.waitForTimeout(1200);
const [cx, cy] = await page.evaluate(() => { const m = window.__v5Map; const c = m.project([13.0075, 51.0045]); return [c.x, c.y]; });
await page.mouse.click(cx, cy);
await page.waitForSelector('.v5-sheet');
check('tapping a Gebiet opens its sheet with size and progress', /ha|km²/.test(await page.locator('.v5-sheet .v5-meta').innerText()));
await page.screenshot({ path: `${shots}/t3-area-sheet.png` });
await page.getByRole('button', { name: 'Eckpunkte bearbeiten' }).click();
await page.waitForSelector('.v5-markbar');
check('edit mode shows the vertex counter', /4\/50/.test(await page.locator('.v5-counter').first().innerText()));

const vertexScreen = async (i) => page.evaluate((index) => { const f = window.__v5Map.querySourceFeatures('v5-draw').filter((x) => x.properties.kind === 'vertex' && Number(x.properties.index) === index)[0]; const c = window.__v5Map.project(f.geometry.coordinates); return [c.x, c.y]; }, i);
const midScreen = async (edge) => page.evaluate((e) => { const f = window.__v5Map.querySourceFeatures('v5-draw').filter((x) => x.properties.kind === 'mid' && Number(x.properties.edge) === e)[0]; const c = window.__v5Map.project(f.geometry.coordinates); return [c.x, c.y]; }, edge);
const dragScreen = async (from, to) => { await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 12 }); await page.mouse.up(); };

const v0 = await vertexScreen(0);
await dragScreen(v0, [v0[0] - 30, v0[1] - 20]);
await page.waitForTimeout(400);
const mid1 = await midScreen(1);
await dragScreen(mid1, [mid1[0] + 25, mid1[1] + 25]);
await page.waitForTimeout(400);
check('dragging an edge midpoint inserts a vertex', /5\/50/.test(await page.locator('.v5-counter').first().innerText()));
await page.screenshot({ path: `${shots}/t4-area-edit.png` });

// invalid shape: drag a vertex across the polygon -> saving is blocked with a reason
const v2 = await vertexScreen(2), v4 = await vertexScreen(4);
await dragScreen(v2, [v4[0] - 6, v4[1] + 6]);
await page.waitForTimeout(500);
const saveBtn = page.getByRole('button', { name: 'Gebiet speichern' });
const blocked = await saveBtn.isDisabled();
check('a self-crossing outline cannot be saved and says why', blocked && /kreuzen|Fläche/.test(await page.locator('.v5-markinfo').innerText()), blocked ? '' : 'save was enabled');
await page.getByRole('button', { name: 'Rückgängig' }).click();
await page.waitForTimeout(400);
check('undo restores a valid outline', await saveBtn.isEnabled());

// delete the new vertex, then save the reshaped Area
const v1 = await vertexScreen(2);
await page.mouse.click(...v1);
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Eckpunkt löschen' }).click();
check('selecting a vertex and pressing delete removes it', /4\/50/.test(await page.locator('.v5-counter').first().innerText()));
await page.getByRole('button', { name: 'Gebiet speichern' }).click();
await page.waitForFunction(() => !document.querySelector('.v5-markbar'), null, { timeout: 30000 });
await page.waitForTimeout(1500);
const changedArea = await areaRing();
check('the new outline is stored through the real mutation endpoint', JSON.stringify(changedArea.ring) !== JSON.stringify(originalArea.ring) && changedArea.updatedAt !== originalArea.updatedAt);
check('map data was refreshed for the new outline', changedArea.packVersion >= 1);

// new Area
await page.getByRole('button', { name: 'Schließen' }).click();
await page.getByRole('button', { name: 'Neues Gebiet' }).click();
await page.waitForSelector('.v5-markbar');
await page.getByRole('button', { name: 'Gebiet speichern' }).click();
await page.waitForFunction(() => !document.querySelector('.v5-markbar'), null, { timeout: 30000 });
const after = await areaRing();
check('a new Gebiet can be created from the seed square', after.count === originalArea.count + 1, `${originalArea.count} -> ${after.count}`);
await ctx.close();
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

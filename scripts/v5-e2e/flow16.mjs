// Diagnose: the ?diag=1 panel (status, engine, sync, network, map, log), the readout, the report, error capture, offline, and privacy.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + String(detail).slice(0, 220) : ''}`); if (!ok) failures++; };
const BASE = 'http://localhost:8140';
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];

const open = async (query, { width = 430, build = false } = {}) => {
  const ctx = await b.newContext({ viewport: { width, height: 932 }, permissions: ['clipboard-read', 'clipboard-write'], origin: BASE });
  await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug${query}`);
  if (build) await page.getByText('Kartendaten fehlen').waitFor({ timeout: 8000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 240000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
};
const tab = async (page, name) => { await page.getByRole('group', { name: 'Bereich' }).getByRole('button', { name, exact: true }).click(); if (process.env.DIAG_DUMP) { await page.waitForTimeout(400); fs.writeFileSync(`${shots}/d16-tab-${name}.txt`, await page.locator('.v5-sheet').innerText()); } };
const sheet = (page) => page.locator('.v5-sheet').innerText();
const overflowX = (page) => page.evaluate(() => { const s = document.querySelector('.v5-sheet'); return s ? s.scrollWidth - s.clientWidth : -1; });

// 1. Normal start: no readout, but the menu has the tile.
let { ctx, page } = await open('', { build: true });
check('without ?diag=1 there is no readout on the map', (await page.locator('.v5-hud').count()) === 0);
await menuTile(page, 'Diagnose');
await page.getByRole('heading', { name: 'Diagnose' }).waitFor();
check('the menu tile opens the diagnostics panel', await page.locator('.v5-sheet[aria-label="Diagnose"]').isVisible());
await ctx.close();

// 2. ?diag=1: panel opens by itself, readout afterwards.
({ ctx, page } = await open('&diag=1'));
await page.getByRole('heading', { name: 'Diagnose' }).waitFor({ timeout: 10000 });
check('?diag=1 opens the panel once the map is up', true);
let text = await sheet(page);
check('status: the Rust/WASM engine is reported', /Rust \/ WASM/.test(text), text.replace(/\n/g, ' | ').slice(0, 160));
check('status: start timings are present (ready after …)', /Bereit nach/i.test(text) && /Kartenpakete/i.test(text));
check('status: findings are in plain German and nothing is flagged as error on a healthy start', !(await page.locator('.ui-notices .ui-notice.error').count()));
check('status: the device block names the browser and the viewport', /Chrome|Chromium|Headless/.test(text) && /430×932/.test(text));
check('no horizontal overflow in the sheet (status, 430 px)', (await overflowX(page)) <= 1, await overflowX(page));
await page.screenshot({ path: `${shots}/d1-status.png` });

// Engine tab
await tab(page, 'Engine');
await page.waitForTimeout(600);
text = await sheet(page);
check('engine: per-call table with round trip and compute time', /area/.test(text) && /Rechenzeit/.test(text) && /tile/.test(text), text.replace(/\n/g, ' | ').slice(0, 200));
check('engine: WASM memory is read from the worker', /WASM-Speicher\s*\n\s*[\d.,]+ (KB|MB)/i.test(text));
await page.locator('.ui-collapse summary').first().click();
text = await sheet(page);
check('engine: the street-engine details of an Area (ways in, houses made, skipped buildings)', /Wege im Paket/i.test(text) && /Häuser erzeugt/i.test(text) && /Gebäude übersprungen/i.test(text));
const waysIn = Number((text.match(/Wege im Paket\s*\n\s*([\d.]+)/i) ?? [])[1]?.replaceAll('.', ''));
check('engine: the numbers are real (ways in > 0)', waysIn > 0, waysIn);
await page.screenshot({ path: `${shots}/d2-engine.png` });

// Network tab: routes by template, no ids
await tab(page, 'Netz');
await page.waitForTimeout(400);
text = await sheet(page);
check('network: routes are grouped by template (meta, state, pack)', /\/meta/.test(text) && /\/state/.test(text) && /\/areas\/:a\/pack/.test(text) && /Anfragen/i.test(text), text.replace(/\n/g, ' | ').slice(0, 200));
check('network: no campaign or Area id anywhere in the panel', !/campaign_n|area_n/.test(text));
check('network: loaded files by kind (JS, WASM …)', /JS/.test(text) && /WASM|CSS/.test(text));
await page.screenshot({ path: `${shots}/d3-net.png` });

// Map tab: after a moment the frame sampler has numbers
await tab(page, 'Karte');
await page.waitForTimeout(2500);
text = await sheet(page);
check('map: library version, layers and the graphics stack', /maplibre-gl/i.test(text) && /Ebenen \/ Quellen/i.test(text) && /Grafik/i.test(text), text.replace(/\n/g, ' | ').slice(0, 200));
check('map: frame rate is measured while the panel is open', /Bildrate\s*\n\s*\d+ \/s/i.test(text), text.match(/Bildrate[^\n]*\n?[^\n]*/i)?.[0]);
await page.screenshot({ path: `${shots}/d4-map.png` });

// 3. A real action shows up in Sync: mark a house, then look.
await page.getByRole('button', { name: 'Schließen' }).click();
check('after closing, the readout stays on screen (?diag=1)', await page.locator('.v5-hud').isVisible());
check('the readout shows fps, memory and sync state', /fps/.test(await page.locator('.v5-hud').innerText()) && /sync|offen|offline/.test(await page.locator('.v5-hud').innerText()), await page.locator('.v5-hud').innerText());
await page.screenshot({ path: `${shots}/d5-hud.png` });
await page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(76, 87), 18.4]);
const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(76, 87));
await page.mouse.click(p[0], p[1]);
await page.waitForSelector('.v5-sheet');
await page.getByRole('button', { name: 'Ausgeteilt' }).first().click();
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Schließen' }).click().catch(() => {});
await page.locator('.v5-hud').click();
await tab(page, 'Sync');
check('sync: the edit was sent and accepted (gesendet / angenommen ≥ 1)', await until(async () => { const t = await sheet(page); const m = t.match(/Gesendet \/ angenommen\s*\n\s*(\d+) \/ (\d+)/i); return m && Number(m[1]) >= 1 && Number(m[2]) >= 1; }, 8000), (await sheet(page)).replace(/\n/g, ' | ').slice(0, 260));
text = await sheet(page);
check('sync: the last rounds are listed with duration and result', /Letzte Runden/i.test(text) && /↑ \d+\s*\n?\s*↓ \d+/.test(text));
check('sync: nothing waits and the state is idle', /Offene Markierungen\s*\n\s*0/i.test(text) && /Zustand\s*\n\s*idle/i.test(text));
await page.screenshot({ path: `${shots}/d6-sync.png` });

// 4. Offline: the edit queues, the finding says so, the panel shows it; back online it recovers.
await page.getByRole('button', { name: 'Schließen' }).click();
await ctx.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(76, 87), 18.4]);
const q = await page.evaluate((c) => { const x = window.__v5Map.project(c); return [x.x, x.y]; }, M(76, 87));
await page.mouse.click(q[0], q[1]);
await page.waitForSelector('.v5-sheet');
await page.getByRole('button', { name: 'Später' }).first().click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Schließen' }).click().catch(() => {});
await page.locator('.v5-hud').click();
text = await sheet(page);
check('offline: status says offline and names the waiting edits', /offline/i.test(text) && /warten|offen/.test(text), text.replace(/\n/g, ' | ').slice(0, 220));
await tab(page, 'Sync');
check('offline: sync shows failed rounds with a retry time', await until(async () => /Fehlversuche\s*\n\s*[1-9]/i.test(await sheet(page)), 15000), (await sheet(page)).replace(/\n/g, ' | ').slice(0, 260));
await tab(page, 'Netz');
check('offline: failed requests are counted in the network tab', /Fehlgeschlagen\s*\n\s*[1-9]/i.test(await sheet(page)));
await page.screenshot({ path: `${shots}/d7-offline.png` });
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await tab(page, 'Sync');
check('back online: the queued edit is sent and the state recovers', await until(async () => /Offene Markierungen\s*\n\s*0/i.test(await sheet(page)), 40000), (await sheet(page)).replace(/\n/g, ' | ').slice(0, 200));

// 5. Log: categories, search, details; an uncaught error is captured and survives the reload.
await page.evaluate(() => { setTimeout(() => { throw new Error('diag-test-boom Max Mustermann 51.12345,13.54321'); }, 10); });
await page.waitForTimeout(400);
await tab(page, 'Log');
text = await sheet(page);
check('log: boot and sync lines are there (info level)', /ready/.test(text) && /sync/.test(text), text.replace(/\n/g, ' | ').slice(0, 200));
await page.getByRole('group', { name: 'Mindeststufe' }).getByRole('button', { name: 'Fehler', exact: true }).click();
{ const t = await sheet(page); check('log: the uncaught error is captured, its foreign text is not kept (only the length)', /uncaught error/i.test(t) && !/Mustermann|51\.12345|diag-test-boom/.test(t), t.replace(/\n/g, ' | ').slice(0, 200)); }
// The five browser counterexamples of review B-F-007: map error, window error, console, copied report, saved tail.
await page.evaluate(() => {
  window.__v5Map.fire('error', { error: new Error('AJAXError: https://tiles.example.test/17/70322/43422.png?key=short-secret&lat=51.12345&lon=13.54321'), sourceId: 'v5-tiles' });
  console.error('Max Mustermann: Hund im Garten, Position 51.12345,13.54321 key=short-secret');
  console.warn(new Error('Max Mustermann: Hund im Garten'));
  setTimeout(() => { throw new Error('Hund im Garten bei tiles.example.test 70322/43422'); }, 5);
  Promise.reject(new Error('Max Mustermann'));
});
await page.waitForTimeout(300);
const PRIVATE = /short-secret|51\.12345|13\.54321|70322|43422|Mustermann|Hund im Garten|tiles\.example\.test/;
check('privacy: the log in the panel holds none of the foreign text', !PRIVATE.test(await sheet(page)));
{ const line = await page.locator('.ui-logitem-btn').first().boundingBox();
  await page.getByRole('button', { name: 'Schließen' }).click(); const hud = await page.locator('.v5-hud').boundingBox(); await page.locator('.v5-hud').click(); await tab(page, 'Log');
  check('UI-Gate: the readout and the log lines are at least 44 px tall', (hud?.height ?? 99) >= 44 && (line?.height ?? 99) >= 44, `hud ${hud?.height} line ${line?.height}`); }
await page.getByRole('group', { name: 'Mindeststufe' }).getByRole('button', { name: 'Info', exact: true }).click();
await page.locator('.v5-sheet').getByLabel('Suche').fill('push');
check('log: search narrows the entries', (await page.locator('.ui-logitem').count()) < 40);
await page.locator('.v5-sheet').getByLabel('Suche').fill('');
await page.screenshot({ path: `${shots}/d8-log.png` });
await tab(page, 'Status');
const status = await sheet(page);
check('status: the error is flagged in plain German', /unerwartete Fehler/.test(status));

// 6. The report: copy, parse, privacy.
await page.getByRole('button', { name: 'Bericht kopieren' }).click();
await page.waitForSelector('text=Bericht kopiert');
const copied = await page.evaluate(() => navigator.clipboard.readText());
if (process.env.DIAG_DUMP) fs.writeFileSync(`${shots}/d16-report.json`, copied);
let rep = null; try { rep = JSON.parse(copied); } catch { /* checked below */ }
check('report: valid JSON with the documented schema', rep?.schema === 'v5-diag-1' && !!rep.metrics && !!rep.subsystems && !!rep.log, copied.slice(0, 80));
check('report: engine, sync, store and map are described by their own subsystems', !!rep?.subsystems?.engine && !!rep?.subsystems?.sync && !!rep?.subsystems?.campaign?.store && !!rep?.subsystems?.map);
check('report: sync counters and engine timings are filled', rep?.metrics?.counters?.['sync.push.sent'] >= 1 && rep?.metrics?.histograms?.['engine.area.rtt_ms']?.n >= 1);
check('report: no campaign id, no session cookie, no token-like string', !/campaign_n|area_n/.test(copied) && !copied.includes(cookies.admin) && !/[A-Za-z0-9_-]{32,}/.test(copied.replace(/"[^"]*\/api\/[^"]*"/g, '')), (copied.match(/[A-Za-z0-9_-]{32,}/) ?? [])[0]);
check('report: a healthy run has no map error besides the one injected above (the feature-state reset names its source layers)', (rep?.metrics?.counters?.['map.errors'] ?? 0) === 1, JSON.stringify(rep?.log?.entries?.filter((e) => e.cat === 'map' && e.lvl !== 'info' && e.lvl !== 'debug')));
check('privacy: the copied report holds none of the foreign text (map error, window error, console, rejection)', !PRIVATE.test(copied), (copied.match(PRIVATE) ?? [])[0]);
check('report: no coordinates', !/"(lat|lng|lon|coordinates|center|position)":\s*[\[\d-]/.test(copied));
check('report: the previous-session slot exists', 'previousSession' in rep);
await page.waitForTimeout(1200); // the warning/error tail is saved with a short delay

// 7. Reload in the same browser profile: the error of the last session is there, in the new session's log.
await page.reload();
await page.waitForSelector('.v5-pill', { timeout: 120000 });
await page.getByRole('heading', { name: 'Diagnose' }).waitFor({ timeout: 20000 });
await tab(page, 'Log');
const prevButton = page.getByRole('button', { name: /Vorherige Sitzung:/ });
check('log: warnings and errors of the previous session are offered', await prevButton.isVisible().catch(() => false));
await prevButton.click().catch(() => {});
check('log: and show the error of the last session (without its text)', /uncaught error/i.test(await sheet(page)) && !PRIVATE.test(await sheet(page)));
check('privacy: the saved tail holds none of the foreign text', !PRIVATE.test(await page.evaluate(() => localStorage.getItem('vf-v5-diag-tail') ?? '')));
await ctx.close();

// 8. Narrow phone and light theme: no overflow, readable.
const narrow = await open('&diag=1', { width: 390 });
await narrow.page.getByRole('heading', { name: 'Diagnose' }).waitFor({ timeout: 10000 });
for (const name of ['Status', 'Engine', 'Sync', 'Netz', 'Karte', 'Log']) { await tab(narrow.page, name); await narrow.page.waitForTimeout(300); if ((await overflowX(narrow.page)) > 1) check(`no horizontal overflow at 390 px (${name})`, false, await overflowX(narrow.page)); }
check('no horizontal overflow in any tab at 390 px', true);
await narrow.page.screenshot({ path: `${shots}/d9-log-390.png` });
await narrow.ctx.close();

// 9. The saved mode switches the readout on and, when switched off in the panel, off again at once (without ?diag=1 in the address).
{
  const saved = await open('');
  await saved.page.evaluate(() => localStorage.setItem('vf-v5-diag', '1'));
  await saved.page.reload();
  await saved.page.waitForSelector('.v5-hud', { timeout: 120000 });
  check('a saved diagnostics mode shows the readout without ?diag=1', await saved.page.locator('.v5-hud').isVisible());
  await saved.page.locator('.v5-hud').click();
  await saved.page.getByRole('checkbox', { name: /Diagnose-Modus dauerhaft/ }).uncheck();
  await saved.page.getByRole('button', { name: 'Schließen' }).click();
  check('switching it off removes the readout right away', await until(async () => (await saved.page.locator('.v5-hud').count()) === 0, 4000), await saved.page.evaluate(() => localStorage.getItem('vf-v5-diag')));
  await saved.ctx.close();
}

await b.close();
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);

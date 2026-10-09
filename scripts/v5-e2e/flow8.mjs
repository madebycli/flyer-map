// Sonder-Marker (pickup tasks): placed snapped to a house with its address, shown as a diamond, status by whoever may edit,
// read-only for a helper without the capability; never part of the street progress.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile, openMenu } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const until = async (predicate, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

async function helper(who) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addCookies([{ name: 'vf_collection_session', value: cookies[who], url: 'http://localhost:8140' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', who, e.message));
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug' + (process.env.V5_QUERY ?? ''));
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const jump = (x, y, z) => page.evaluate(async ([c, zoom]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } }); await new Promise((r) => m.once('idle', r)); await new Promise((r) => setTimeout(r, 250)); }, [M(x, y), z]);
  const click = async (x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
  const pins = () => page.evaluate(() => window.__v5Map.getSource('v5-pickups')._data?.features?.length ?? 0);
  return { ctx, page, jump, click, pins };
}

const A = await helper('alice');
// Take the west Area first so there is map data to snap to.
await menuTile(A.page, 'Gebiete');
await A.page.locator('.v5-arearow', { hasText: 'West' }).getByRole('button', { name: /übernehmen/ }).click();
await until(async () => Number(await A.page.locator('.v5-pill').getAttribute('data-total')) > 0, 40000);
await A.page.getByRole('button', { name: 'Schließen' }).click();

await openMenu(A.page);
check('a helper with the capability gets the Sonder-Marker tool', (await A.page.getByRole('button', { name: 'Sonder-Marker', exact: true }).count()) === 1);
await A.page.getByRole('button', { name: 'Sonder-Marker', exact: true }).click();
await A.jump(116, 13, 18.1);
await A.click(119, 16); // a few metres beside the house
await A.page.waitForSelector('.v5-form');
check('the marker snapped to the house and took its address', (await A.page.getByLabel('Adresse').inputValue()).length > 0 && /Am Haus/.test(await A.page.locator('.v5-form .v5-hint').innerText()), await A.page.getByLabel('Adresse').inputValue());
check('saving needs a title', await A.page.getByRole('button', { name: 'Sonder-Marker speichern' }).isDisabled());
await A.page.getByLabel('Titel').fill('Kleidersack Hintertür');
await A.page.getByLabel('Hinweis').fill('Klingel defekt');
await A.page.screenshot({ path: `${shots}/f8-form.png` });
await A.page.getByRole('button', { name: 'Sonder-Marker speichern' }).click();
check('the Sonder-Marker shows up as a pin', await until(async () => (await A.pins()) === 1));
const progressBefore = await A.page.locator('.v5-pill').getAttribute('data-done');

// Tap the pin, set its status.
await A.page.getByRole('button', { name: 'Fertig' }).click();
const pin = await A.page.evaluate(() => { const f = window.__v5Map.getSource('v5-pickups')._data.features[0]; const p = window.__v5Map.project(f.geometry.coordinates); return [p.x, p.y]; });
await A.page.mouse.click(pin[0], pin[1]);
await A.page.waitForSelector('.v5-sheet');
check('tapping the pin opens it with title and address', /Kleidersack/.test(await A.page.locator('.v5-sheet').innerText()) && /Klingel defekt/.test(await A.page.locator('.v5-sheet').innerText()));
await A.page.getByRole('button', { name: 'Abgeholt' }).click();
check('the status change is stored', await until(async () => A.page.evaluate(async () => { const r = await (await fetch('/api/campaigns/campaign_n/collection/snapshot')).json(); return r.collection.pickups.some((p) => p.status === 'collected'); })));
check('Sonder-Marker never change the street progress', (await A.page.locator('.v5-pill').getAttribute('data-done')) === progressBefore);
await A.page.screenshot({ path: `${shots}/f8-pickup.png` });

// A helper without the capability sees it but cannot change it.
const B = await helper('bob');
check('the other helper sees the pin', await until(async () => (await B.pins()) === 1));
await openMenu(B.page);
check('and has no tool to place new ones', (await B.page.getByRole('button', { name: 'Sonder-Marker', exact: true }).count()) === 0);
await B.page.getByRole('button', { name: 'Schließen' }).click();
const pinB = await B.page.evaluate(() => { const f = window.__v5Map.getSource('v5-pickups')._data.features[0]; window.__v5Map.jumpTo({ center: f.geometry.coordinates, zoom: 18 }); return f.geometry.coordinates; });
await B.page.waitForTimeout(800);
const pb = await B.page.evaluate((c) => { const p = window.__v5Map.project(c); return [p.x, p.y]; }, pinB);
await B.page.mouse.click(pb[0], pb[1]);
await B.page.waitForSelector('.v5-sheet');
check('the pin is read-only for him', (await B.page.getByRole('button', { name: 'Nochmal' }).count()) === 0 && /Abgeholt/.test(await B.page.locator('.v5-sheet').innerText()));
await A.ctx.close(); await B.ctx.close(); await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

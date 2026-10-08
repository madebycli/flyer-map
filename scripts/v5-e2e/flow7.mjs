// Abholaktion: two helpers come in through the Abhol-Link, take an Area (Übernehmen), the second joins its Room (Teilnehmen),
// marking works only inside the held Area, finishing greys the Area out; the legacy mutations run against the real Worker.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
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
  const serverStates = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.map((o) => `${o.key}=${o.status}@${o.area}`));
  return { ctx, page, jump, click, serverStates };
}
const openList = async (p) => { if (await p.page.locator('.v5-sheet').count()) await p.page.getByRole('button', { name: 'Schließen' }).first().click(); await p.page.getByRole('button', { name: 'Gebiete', exact: true }).click(); await p.page.waitForSelector('.v5-arearow'); };
const row = (p, name) => p.page.locator('.v5-arearow', { hasText: name });

const A = await helper('alice');
check('a helper lands in the collection view with the Gebiete list, no distribution tools', (await A.page.getByRole('button', { name: 'Gebiete', exact: true }).count()) === 1 && (await A.page.getByRole('button', { name: 'Markieren' }).count()) === 0);
await openList(A);
check('both Areas are listed as open', (await A.page.locator('.v5-arearow[data-phase="open"]').count()) === 2);
await A.page.screenshot({ path: `${shots}/f7-list-open.png` });

// Übernehmen creates the Room and starts the Area.
await row(A, 'West').getByRole('button', { name: /übernehmen/ }).click();
check('taking an Area makes it "wird bearbeitet" with the helper in the Room', await until(async () => (await row(A, 'West').getAttribute('data-phase')) === 'working' && /Nutzer 1/.test(await row(A, 'West').innerText())));
check('the other Area stays open', (await row(A, 'Ost').getAttribute('data-phase')) === 'open');

// Marking is possible inside the held Area only.
await A.page.getByRole('button', { name: 'Schließen' }).click();
await A.page.waitForFunction(() => window.__v5Boot, null, { timeout: 60000 });
check('the pack of the new Area was fetched and the map has houses', await until(async () => Number(await A.page.locator('.v5-pill').getAttribute('data-total')) > 0, 30000));
await A.jump(116, 13, 18.1);
await A.click(116, 13);
await A.page.waitForSelector('.v5-sheet');
check('status buttons use the Abhol wording', (await A.page.getByRole('button', { name: 'Abgeholt' }).count()) === 1);
await A.page.getByRole('button', { name: 'Abgeholt' }).click();
check('a mark inside the held Area reaches the server under that Area', await until(async () => (await A.serverStates()).some((s) => s.startsWith('h:') && s.endsWith('=completed@c_west'))));
await A.page.getByRole('button', { name: 'Schließen' }).click();
await A.jump(900, 13, 18.1);
await A.click(900, 13);
await A.page.waitForTimeout(500);
check('a house in the other, untaken Area offers no status buttons', (await A.page.getByRole('button', { name: 'Abgeholt' }).count()) === 0);
await A.page.screenshot({ path: `${shots}/f7-foreign-house.png` });

// Second helper sees the Room and joins instead of creating a competing one.
const B = await helper('bob');
await openList(B);
check('the second helper sees the Area as taken, with the first helper in it', await until(async () => (await row(B, 'West').getAttribute('data-phase')) === 'working' && /Nutzer 1/.test(await row(B, 'West').innerText())));
check('joining is offered, taking it again is not', (await row(B, 'West').getByRole('button', { name: /teilnehmen/ }).count()) === 1 && (await row(B, 'West').getByRole('button', { name: /übernehmen/ }).count()) === 0);
await row(B, 'West').getByRole('button', { name: /teilnehmen/ }).click();
check('after joining, both names are in the Room', await until(async () => { await B.page.getByRole('button', { name: /^West/ }).click().catch(() => {}); return (await B.page.locator('.v5-member').count()) === 2; }, 8000));
await B.page.screenshot({ path: `${shots}/f7-room.png` });
check('only one Room exists on the server', await B.page.evaluate(async () => { const m = await (await fetch('/api/v5/campaigns/campaign_n/meta')).json(); return m.runs.length === 1 && m.runs[0].members.length === 2; }));

// The joined helper may mark in the same Area.
await B.page.getByRole('button', { name: 'Schließen' }).click();
await B.page.waitForFunction(() => Number(document.querySelector('.v5-pill')?.getAttribute('data-total')) > 0, null, { timeout: 30000 });
await B.jump(136, 13, 18.1);
await B.click(136, 13);
await B.page.waitForSelector('.v5-sheet');
await B.page.getByRole('button', { name: 'Später' }).click();
check('the joined helper’s mark is stored', await until(async () => (await B.serverStates()).some((s) => s.endsWith('=later@c_west'))));
check('and the first helper sees the shared progress', await until(async () => { await A.page.evaluate(() => window.dispatchEvent(new Event('online'))); return (await A.serverStates()).filter((s) => s.endsWith('@c_west')).length >= 2; }));

// Leaving and rejoining is possible (the legacy Run could not do this).
await B.page.getByRole('button', { name: 'Schließen' }).click();
await openList(B);
await B.page.getByRole('button', { name: /^West/ }).click();
await B.page.getByRole('button', { name: 'Raum verlassen' }).click();
check('leaving takes the helper out of the Room', await until(async () => (await B.page.getByRole('button', { name: 'Teilnehmen' }).count()) === 1));
await B.page.getByRole('button', { name: 'Teilnehmen' }).click();
check('and rejoining works', await until(async () => (await B.page.getByRole('button', { name: 'Raum verlassen' }).count()) === 1));
await B.ctx.close();

// A cannot be written to after release; completion greys the Area out for everybody.
await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
await openList(A);
await A.page.getByRole('button', { name: /^West/ }).click();
await A.page.getByRole('button', { name: 'Gebiet erledigt' }).click();
check('finishing marks the Area as done', await until(async () => (await A.page.locator('.v5-sheet').innerText()).includes('Erledigt')));
await A.page.getByRole('button', { name: 'Schließen' }).click();
await openList(A);
check('a finished Area is greyed and offers nothing', (await row(A, 'West').getAttribute('data-phase')) === 'done' && (await row(A, 'West').getByRole('button', { name: /übernehmen|teilnehmen/ }).count()) === 0);
await A.page.screenshot({ path: `${shots}/f7-list-done.png` });
await A.ctx.close(); await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

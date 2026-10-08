// Two people overwrite the same street: nobody is silently reset, the one who lost is told and can restore.
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
  await page.waitForFunction(() => window.__v5Map && window.__v5Map.getSource('v5-houses'), null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  const jump = (x, y, z) => page.evaluate(async ([c, zoom]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), z]);
  const click = async (x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
  const streetStatus = () => page.evaluate(async () => { const r = await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json(); const row = r.ops.find((o) => o.key.startsWith('s:s1000:') && o.status !== 'open'); return row?.status ?? 'open'; });
  return { ctx, page, gate, jump, click, streetStatus };
}

const A = await person('admin'), B = await person('editor');
for (const p of [A, B]) await p.jump(180, 0, 17.4);

// A marks the street while offline, then B marks the same street differently, online and later.
A.gate.blocked = true;
await A.click(180, 0);
await A.page.waitForSelector('.v5-sheet');
await A.page.getByRole('button', { name: 'Erledigt' }).first().click();
await A.page.waitForTimeout(400);
await B.click(180, 0);
await B.page.waitForSelector('.v5-sheet');
await B.page.getByRole('button', { name: 'Später' }).first().click();
check('B’s edit reaches the server', await until(async () => (await B.streetStatus()) === 'later'));

// A comes back: B’s newer edit stands, A is told instead of being silently reset.
A.gate.blocked = false;
await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
check('A is told that the street was overwritten', await until(async () => (await A.page.locator('.v5-conflict').count()) === 1));
check('A now sees B’s status, not a phantom of its own', (await A.page.locator('.v5-seg-btn.on').count()) === 1 && /Später/.test(await A.page.locator('.v5-seg-btn.on').innerText()));
check('the server was not reset', (await A.streetStatus()) === 'later');

// A restores its own version on purpose: that is a new edit and wins everywhere.
await A.page.locator('.v5-conflict').click();
await A.page.getByRole('button', { name: 'Meine Version wiederherstellen' }).click();
check('the explicit restore reaches the server', await until(async () => (await A.streetStatus()) === 'completed'));
await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
check('B is told in turn', await until(async () => (await B.page.locator('.v5-conflict').count()) === 1));
await A.ctx.close(); await B.ctx.close(); await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

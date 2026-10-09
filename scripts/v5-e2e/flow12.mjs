// Zugänge: the admin creates links in the field map, people open them (new address and old address), the token is exchanged for a session and
// removed from the address bar, a revoked link stops working, Abhol-Links open the collection side.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const BASE = 'http://localhost:8140';
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };

const adminCtx = await b.newContext({ viewport: { width: 430, height: 932 } });
await adminCtx.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const admin = await adminCtx.newPage();
admin.on('pageerror', (e) => console.log('PAGEERROR admin', e.message));
await admin.goto(`${BASE}/v5.html?campaign=campaign_n`);
await admin.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => admin.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await admin.waitForSelector('.v5-pill', { timeout: 120000 });

async function visit(url, label) {
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', label, e.message));
  await page.goto(url);
  return { ctx, page };
}

// 1. Create a viewer link
await menuTile(admin, 'Zugänge');
await admin.getByRole('button', { name: 'Ansehen' }).click();
await admin.getByLabel('Name des Links').fill('Nachbarn');
await admin.getByRole('button', { name: 'Link erstellen', exact: true }).click();
await admin.getByLabel('Zugangslink').waitFor();
const viewerLink = await admin.getByLabel('Zugangslink').inputValue();
check('the link points at the field map with the token in the fragment', /\/v5\?campaign=campaign_n#access=[A-Za-z0-9_-]{32,}$/.test(viewerLink), viewerLink.replace(/access=.*/, 'access=…'));
check('it is also offered as a QR code', (await admin.locator('.v5-qr svg').count()) === 1);
await admin.screenshot({ path: `${shots}/a1-access.png` });
await admin.getByRole('button', { name: 'Fertig' }).click();
check('the new link is listed under the active links', await until(async () => /Nachbarn/.test(await admin.locator('.v5-sheet').innerText())));

// 2. Open it as someone with no session
{
  const { ctx, page } = await visit(viewerLink, 'viewer');
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  check('the link is redeemed and the token is gone from the address bar', await page.evaluate(() => location.hash === '' && !location.href.includes('access=')), await page.evaluate(() => location.href));
  check('a viewer link opens read-only (no marking button)', (await page.getByRole('button', { name: 'Markieren starten' }).count()) === 0);
  await ctx.close();
}
// 3. The old map address with the same token still works and ends up in the field map
{
  const old = viewerLink.replace('/v5?campaign=campaign_n#', '/?campaign=campaign_n#');
  const { ctx, page } = await visit(old, 'old-address');
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  check('an old-address link is forwarded to the field map', await page.evaluate(() => location.pathname === '/v5' && location.hash === ''), await page.evaluate(() => location.href));
  await ctx.close();
}
// 4. Abhol-Link
await admin.getByRole('button', { name: 'Abhol-Link erstellen' }).click();
await admin.locator('.v5-syncbox[aria-label="Link für Abhol-Helfer"]').waitFor();
const helperLink = await admin.getByLabel('Zugangslink').inputValue();
check('the Abhol-Link opens the collection side', /kind=collection#collection=/.test(helperLink), helperLink.replace(/collection=[A-Za-z0-9_-]{20,}$/, 'collection=…'));
{
  const { ctx, page } = await visit(helperLink, 'helper');
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  check('a helper arrives in collection mode with the token removed', await page.evaluate(() => new URL(location.href).searchParams.get('kind') === 'collection' && location.hash === ''));
  await page.screenshot({ path: `${shots}/a2-helper.png` });
  await ctx.close();
}
// 5. Revoke, then the link is refused with a clear message
await admin.getByRole('button', { name: 'Fertig' }).click();
await admin.getByRole('button', { name: 'Link Nachbarn widerrufen' }).click();
check('a revoked link disappears from the list', await until(async () => !/Nachbarn/.test(await admin.locator('.v5-sheet').innerText())));
{
  const { ctx, page } = await visit(viewerLink, 'revoked');
  check('the revoked link says so and offers no map', await until(async () => /Link ungültig/.test(await page.locator('.v5-card').innerText().catch(() => ''))) && (await page.locator('.v5-pill').count()) === 0);
  await page.screenshot({ path: `${shots}/a3-revoked.png` });
  await ctx.close();
}
{
  const { ctx, page } = await visit(`${BASE}/v5?campaign=campaign_n#access=${'z'.repeat(40)}`, 'garbage');
  check('a made-up token is refused', await until(async () => /Link ungültig/.test(await page.locator('.v5-card').innerText().catch(() => ''))));
  await ctx.close();
}
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

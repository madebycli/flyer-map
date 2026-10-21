// Installing and opening as an app: the manifest, the guide for iOS and Android (before the app, once skipped it stays away), the installed app's start page
// (paste an invitation link), and the service worker (the app shell starts without a network).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const V5 = `${BASE}/v5.html?campaign=campaign_n`;
const phone = async (userAgent, { standalone = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent, hasTouch: true, isMobile: true });
  await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
  // a real phone browser is not automated; the standalone case pretends to be the installed app
  await context.addInitScript((isStandalone) => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    if (isStandalone) { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (q.includes('display-mode: standalone') ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : mm(q)); }
  }, standalone);
  return context;
};

// ── manifest ─────────────────────────────────────────────────────────────
{
  const response = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await response.json();
  check('the manifest makes a standalone app with a start URL inside its scope', manifest.display === 'standalone' && manifest.start_url.startsWith('/') && manifest.scope === '/' && manifest.background_color === '#0a0f0e', JSON.stringify(manifest).slice(0, 200));
  const sizes = new Set(manifest.icons.map((i) => i.sizes));
  check('with 192, 512 and a maskable icon', sizes.has('192x192') && sizes.has('512x512') && manifest.icons.some((i) => i.purpose === 'maskable'));
  let allOk = true;
  for (const icon of manifest.icons) { const r = await fetch(`${BASE}${icon.src}`); if (!r.ok) allOk = false; }
  check('every icon exists', allOk);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/v5.html?campaign=campaign_n`, { waitUntil: 'commit' });
  const links = await page.evaluate(() => ({ manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href'), touch: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'), capable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content }));
  check('both pages point to the manifest and the Apple touch icon', links.manifest === '/manifest.webmanifest' && links.touch === '/apple-touch-icon.png' && links.capable === 'yes', JSON.stringify(links));
  await page.context().close();
}

// ── the guide ────────────────────────────────────────────────────────────
for (const [name, userAgent, steps, expect] of [['iPhone', IPHONE, 3, 'Teilen'], ['Android', ANDROID, 3, 'drei Punkte']]) {
  const context = await phone(userAgent);
  const page = await context.newPage();
  page.on('pageerror', (error) => check(`${name}: page error ${error.message}`, false));
  await page.goto(`${V5}#access=${'a'.repeat(40)}`);
  const guide = page.locator('.pwa-page');
  await guide.waitFor({ timeout: 10000 });
  check(`${name}: the guide comes before the app`, (await page.locator('.pwa-head h1').textContent()) === 'Als App installieren' && !(await page.locator('.v5-pill').count()));
  check(`${name}: three steps, each with a picture, for this system`, (await page.locator('.pwa-step').count()) === steps && (await page.locator('.pwa-step .pwa-glyph svg').count()) === steps && (await guide.textContent()).includes(expect), (await guide.textContent()).slice(0, 200));
  check(`${name}: targets are at least 44 px`, await page.locator('.pwa-btn').evaluateAll((els) => els.every((el) => el.getBoundingClientRect().height >= 44)));
  const geometry = await page.evaluate(() => {
    const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
    const inside = [...document.querySelectorAll('.pwa-page *')].every((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= w + 0.5); });
    const buttons = [...document.querySelectorAll('.pwa-btn')].map((b) => Math.round(b.getBoundingClientRect().height));
    const pair = [...document.querySelectorAll('.pwa-pair .pwa-btn')].map((b) => Math.round(b.getBoundingClientRect().width));
    const page = document.querySelector('.pwa-page');
    return { inside, equalHeights: new Set(buttons).size === 1, pairEqual: pair.length < 2 || Math.abs(pair[0] - pair[1]) <= 1, noScroll: page.scrollHeight <= page.clientHeight + 1, buttons, pair, scroll: [page.scrollHeight, page.clientHeight] };
  });
  check(`${name}: nothing reaches past the screen edge`, geometry.inside);
  check(`${name}: all buttons are the same height, the two in a row the same width`, geometry.equalHeights && geometry.pairEqual, JSON.stringify(geometry));
  check(`${name}: the whole guide fits one phone screen without scrolling`, geometry.noScroll, JSON.stringify(geometry.scroll));
  const copy = page.getByRole('button', { name: 'Link kopieren' });
  check(`${name}: with an access link in the address, the link can be copied`, (await copy.count()) === 1);
  await page.screenshot({ path: `${shots}/t30-guide-${name.toLowerCase()}.png`, fullPage: false });
  await page.getByRole('button', { name: 'Im Browser öffnen' }).click();
  await page.waitForSelector('.v5-pill, .v5-overlay', { timeout: 120000 }).catch(() => {});
  check(`${name}: "open in the browser anyway" goes on to the app`, (await page.locator('.pwa-page').count()) === 0);
  await page.reload();
  await page.waitForTimeout(1500);
  check(`${name}: and the guide stays away afterwards`, (await page.locator('.pwa-page').count()) === 0);
  await context.close();
}
// the guide fits the browser: Brave on the iPad has its own steps; with the system install button on Android there are no steps at all
{
  const BRAVE = 'Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1 Brave';
  const context = await phone(BRAVE);
  const page = await context.newPage();
  await page.goto(V5);
  await page.locator('.pwa-page').waitFor({ timeout: 10000 });
  const titles = await page.locator('.pwa-step b').allTextContents();
  check('Brave on iOS: Teilen, then Mehr, then Zum Home-Bildschirm', titles.join('|') === 'Teilen|Mehr|Zum Home-Bildschirm|Hinzufügen', titles.join('|'));
  check('and no three dots in a column are mentioned there', !(await page.locator('.pwa-page').textContent()).includes('drei Punkte'));
  await context.close();
}
{
  const context = await phone(ANDROID);
  const page = await context.newPage();
  await page.goto(V5);
  await page.locator('.pwa-page').waitFor({ timeout: 10000 });
  const before = await page.locator('.pwa-step').count();
  // the browser offers its install dialog: the guide turns into one button
  await page.evaluate(() => { const event = new Event('beforeinstallprompt'); event.prompt = async () => { window.__prompted = true; }; event.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(event); });
  await page.waitForFunction(() => !document.querySelector('.pwa-step'), null, { timeout: 5000 });
  const install = page.getByRole('button', { name: 'App installieren' });
  check('Android with the install event: no steps, one big button', before === 3 && (await page.locator('.pwa-step').count()) === 0 && (await install.count()) === 1);
  await page.screenshot({ path: `${shots}/t30-guide-direct.png` });
  await install.click();
  check('the button opens the system dialog', await until(() => page.evaluate(() => window.__prompted === true)));
  await context.close();
}

{
  // the installed app and a desktop browser never see the guide
  const installed = await phone(IPHONE, { standalone: true });
  const page = await installed.newPage();
  await page.goto(V5);
  await page.waitForTimeout(2500);
  check('the installed app does not show the guide', (await page.locator('.pwa-page').count()) === 0);
  await installed.close();
  const desktop = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const d = await desktop.newPage();
  await d.goto(V5);
  await d.waitForTimeout(2000);
  check('a desktop browser does not show the guide', (await d.locator('.pwa-page').count()) === 0);
  await desktop.close();
}

// ── the installed app's start page ───────────────────────────────────────
{
  const context = await phone(IPHONE, { standalone: true });
  const page = await context.newPage();
  page.on('pageerror', (error) => check(`start page error ${error.message}`, false));
  await page.goto(`${BASE}/?source=pwa`);
  await page.locator('.pwa-page').waitFor({ timeout: 10000 });
  check('the installed app opens a start page', (await page.locator('.pwa-head h1').textContent()) === 'Verteil-Flyer' && (await page.getByRole('link', { name: 'Als Organisator anmelden' }).count()) === 1);
  const input = page.getByRole('textbox', { name: 'Zugangslink einfügen' });
  check('start page: nothing reaches past the screen edge', await page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('.pwa-page *')].every((el) => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= w + 0.5); }); }));
  await input.fill('das ist kein link');
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  check('a text that is not a link is refused with a message', await page.getByRole('alert').isVisible());
  await input.fill('https://evil.example/v5?campaign=campaign_n#access=' + 'a'.repeat(40));
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  check('a link of another site is refused too', await page.getByRole('alert').isVisible() && page.url().startsWith(BASE + '/?source=pwa'));
  await page.screenshot({ path: `${shots}/t30-start.png` });
  await input.fill(`${BASE}/v5?campaign=campaign_n`);
  await Promise.all([page.waitForURL(/\/v5\?campaign=campaign_n/, { timeout: 10000 }), page.getByRole('button', { name: 'Öffnen', exact: true }).click()]);
  check('a pasted link of this app opens the field map', page.url().includes('/v5?campaign=campaign_n'));
  await page.waitForSelector('.v5-pill, .v5-overlay', { timeout: 120000 }).catch(() => {});
  await page.goto(`${BASE}/?source=pwa`);
  check('the next start offers the last Aktion', (await page.getByRole('link', { name: 'Weiter mit der letzten Aktion' }).count()) === 1);
  await context.close();
}

// ── the service worker: the app shell starts without a network ───────────
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
  await context.addInitScript(() => { try { localStorage.setItem('vf-sw', 'on'); } catch { /* */ } });
  const page = await context.newPage();
  await page.goto(V5);
  await page.waitForSelector('.v5-pill, .v5-overlay', { timeout: 120000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const registration = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return { script: r?.active?.scriptURL ?? null, scope: r?.scope ?? null }; });
  check('the service worker is registered per build', /\/sw\.js\?v=\d+$/.test(registration.script ?? ''), JSON.stringify(registration));
  await page.reload(); // now controlled; the shell and its files get cached while it loads
  await page.waitForSelector('.v5-pill, .v5-overlay', { timeout: 120000 });
  await page.waitForTimeout(1500);
  const caches = await page.evaluate(async () => { const names = await caches.keys(); const pages = names.find((n) => n.startsWith('vf-pages-')); return { names, pages: pages ? (await (await caches.open(pages)).keys()).map((r) => new URL(r.url).pathname) : [] }; });
  check('the page shell and the hashed files are cached', caches.pages.includes('/v5.html') && caches.names.includes('vf-files'), JSON.stringify(caches));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  const offline = await until(async () => (await page.locator('#root').innerHTML().catch(() => '')).length > 50, 20000);
  check('offline, the app still starts from the cached shell', offline);
  await page.screenshot({ path: `${shots}/t30-offline.png` });
  await context.setOffline(false);
  // API calls never come from a cache
  const api = await page.evaluate(async () => (await fetch('/api/v5/campaigns/campaign_n/meta')).status);
  check('API answers are never served from the cache', api === 200, String(api));
  await context.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

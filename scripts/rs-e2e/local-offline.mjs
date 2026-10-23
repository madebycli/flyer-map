// Installable and offline-hard, against the local Worker (scripts/rs-e2e/app-local.sh): after the first visit the shell (service worker), the Aktion (the last /meta)
// and the map data of the Gebiete (the last packs) are on the device; with the network cut a reload still starts the app with its map, a marking is queued, and when the
// network is back the queue goes to the server. Chromium headless only (the browser's offline switch, not a real dead zone).
import { launch, mapReady, reporter, shots } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs, serverStatuses } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
await buildPacks();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const address = `${APP}?debug&campaign=${CAMPAIGN}`;
// while the network is cut the browser itself reports every refused request; that is the cut, not a fault of the app
const CUT = /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch|NetworkError|net::ERR/;

const v = { width: 390, height: 844 };
const context = await contextAs(browser, 'admin', { viewport: v, hasTouch: true, isMobile: true });
const page = await context.newPage();
const problems = [];
let cut = false;
page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text()) && !(cut && CUT.test(m.text()))) problems.push(`${m.type()} ${m.text()}`); });
const ready = async () => {
  await page.waitForSelector('.fm-app', { timeout: 40000 });
  await mapReady(page);
  await page.waitForFunction(() => window.__rsApp && Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 40000 });
};

// first visit, online
await page.goto(address);
await ready();
const manifest = await page.evaluate(async () => { const link = document.querySelector('link[rel=manifest]'); const r = await fetch(link.href); return { ok: r.ok, body: await r.json() }; });
check('installable: the page has a manifest with a name, a start page, standalone display and icons', manifest.ok && manifest.body.display === 'standalone' && manifest.body.icons.length >= 2 && !!manifest.body.name, JSON.stringify(manifest.body).slice(0, 80));
await page.evaluate(() => navigator.serviceWorker.ready);
const cached = await page.evaluate(async () => { const names = (await caches.keys()).filter((k) => k.startsWith('fm-shell-')); const c = await caches.open(names[0]); return { caches: names.length, files: (await c.keys()).length }; });
check('the service worker holds the shell of this build', cached.caches === 1 && cached.files >= 10, `${cached.caches} cache, ${cached.files} files`);
await sleep(2000); // the overlay of known statuses settles after the field (the denominator leaves the not-possible houses out)
const total = Number(await page.locator('.v5-pill').getAttribute('data-total'));
// a reload so that the worker controls the page, then the cut
await page.reload();
await ready();
check('the worker controls the page after the second load', await page.evaluate(() => !!navigator.serviceWorker.controller));
const stored = await page.evaluate(async () => { const dbs = (await indexedDB.databases?.()) ?? []; return dbs.map((d) => d.name).filter((n) => n.startsWith('fm-cache:')); });
check('the Aktion and its map data were remembered on the device', stored.length === 1, stored.join(','));

// the cut
await context.setOffline(true);
cut = true;
await page.reload();
await ready();
check('offline: a reload still starts the app', (await page.locator('.fm-app').count()) === 1);
await sleep(2000);
check('offline: with the same Gebiete and houses', Number(await page.locator('.v5-pill').getAttribute('data-total')) === total, `${total}`);
check('offline: and the map has its tiles', await page.waitForFunction(() => window.__rsDebug().protocol.tiles - window.__rsDebug().protocol.empty > 0, null, { timeout: 30000 }).then(() => true, () => false));
await sleep(500);
await page.screenshot({ path: `${shots}/390x844-dark-offline-start.png` });

// a marking while there is no network
const gebiete = JSON.parse(await page.evaluate(() => window.__rsApp.gebiete()));
const keys = await page.evaluate((id) => window.__rsApp.keys(id, 40), gebiete[0].id);
const before = await serverStatuses();
const fresh = keys.filter((k) => !before[k]).slice(0, 3);
const marked = await page.evaluate((ks) => window.__rsApp.mark(ks, 'completed'), fresh);
check('offline: markings are taken', marked === fresh.length && fresh.length === 3, `${marked}`);
await page.waitForFunction(() => JSON.parse(window.__rsApp.sync()).queued >= 3, null, { timeout: 10000 });
check('offline: and queued on the device', true);
await sleep(300);
const quick = await page.locator('[data-quick=sync]').getAttribute('class');
check('offline: the sync button says there is no connection', /offline/.test(quick ?? ''), quick);
await page.screenshot({ path: `${shots}/390x844-dark-offline-queued.png` });

// the network is back: the queue goes
cut = false;
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => { const s = JSON.parse(window.__rsApp.sync()); return s.state === 'idle' && s.queued === 0; }, null, { timeout: 40000 });
const after = await serverStatuses();
check('back online: the queued markings reached the server', fresh.every((k) => after[k] === 'completed'), fresh.join(' '));
check('console is quiet (apart from the cut itself)', problems.length === 0, problems.join(' | '));
await context.close();
await browser.close();
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

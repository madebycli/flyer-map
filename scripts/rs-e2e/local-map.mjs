// The map with real data (made-up, no network): the app against the local Worker (scripts/rs-e2e/app-local.sh). Proves that the map draws tiles of the
// engine (counted, not just "no error"), that paths are dashed and streets solid, that the roles see what they should, that the theme can change under the
// map, and that the position button works. 390x844 dark and 1280x800 light.
import { VIEWS, launch, counters, mapReady, openPage, reporter, screenOf, shots, tilesDrawn, view, withDebug } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
await buildPacks();
const address = withDebug(APP, `campaign=${CAMPAIGN}`);
const AREA_N = [13.005, 51.005];

async function run(v) {
  const tag = `${v.width}x${v.height}-${v.theme}`;
  const context = await contextAs(browser, 'admin', { viewport: { width: v.width, height: v.height }, hasTouch: v.width < 600, isMobile: v.width < 600, permissions: ['geolocation'], geolocation: { latitude: AREA_N[1] + 0.001, longitude: AREA_N[0] + 0.001, accuracy: 15 } });
  if (v.theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });

  const t0 = Date.now();
  await page.goto(address);
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  await mapReady(page);
  // the camera starts on the whole Aktion (far out the tiles are not asked for); go to a Gebiet like a person zooming in
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 15.5 }), AREA_N);
  await tilesDrawn(page, 1);
  check(`${tag}: the map shows tiles of the engine`, true, `${Date.now() - t0} ms to the first tile`);
  // the data of the Gebiete is loaded: the pill counts the houses
  await page.waitForFunction(() => Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 30000 });
  const total = Number(await page.locator('.v5-pill').getAttribute('data-total'));
  check(`${tag}: the pill counts the houses of the loaded Gebiete`, total > 50, `${total} houses`);
  check(`${tag}: no loading note is left`, (await page.locator('[data-field]').count()) === 0);

  // zoom into a Gebiet: houses and streets are drawn from the engine's tiles
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 17 }), AREA_N);
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-houses-fill'] }).length > 5, null, { timeout: 30000 });
  const drawn = await page.evaluate(() => {
    const q = (id) => window.__rsMap.queryRenderedFeatures({ layers: [id] }).length;
    return { houses: q('v5-houses-fill'), streets: q('v5-segments-line'), paths: q('v5-paths-line') };
  });
  check(`${tag}: houses and streets are on the screen`, drawn.houses > 5 && drawn.streets > 3, JSON.stringify(drawn));
  const c = await counters(page);
  check(`${tag}: the tile counters say so`, c.protocol.tiles - c.protocol.empty >= 1 && c.protocol.bytes > 1000 && c.protocol.failed === 0 && c.tiles['v5-tiles'] >= 1, JSON.stringify(c.protocol));
  const dashes = await page.evaluate(() => ({ path: window.__rsMap.getPaintProperty('v5-paths-line', 'line-dasharray'), street: window.__rsMap.getPaintProperty('v5-segments-line', 'line-dasharray') }));
  check(`${tag}: paths are dashed and streets are solid`, Array.isArray(dashes.path) && !dashes.street, JSON.stringify(dashes));
  // the footway of the made-up neighbourhood lies in the south-west corner of the Gebiet: a path with houses is drawn, as a dashed line
  await page.evaluate(() => window.__rsMap.jumpTo({ center: [13.0007, 51.0002], zoom: 18 }));
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-paths-line'] }).length > 0, null, { timeout: 30000 });
  check(`${tag}: a path with houses is on the screen`, true);
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 17 }), AREA_N);
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-houses-fill'] }).length > 5, null, { timeout: 30000 });
  await page.screenshot({ path: `${shots}/${tag}-map-houses.png` });

  // the whole Aktion in view, and the other Gebiet is there too (admin)
  await page.evaluate(() => window.__rsMap.fitBounds([[13.0, 51.0], [13.03, 51.011]], { duration: 0 }));
  await page.waitForTimeout(600);
  const outlines = await page.evaluate(() => window.__rsMap.querySourceFeatures('v5-areas').length);
  check(`${tag}: both Gebiete are outlined`, outlines >= 2, `${outlines} features`);
  await page.screenshot({ path: `${shots}/${tag}-map-real.png` });

  // the position button: a dot on the map, the camera goes there (the position stays on the device)
  await page.locator('[data-quick=locate]').click();
  await page.waitForFunction(() => window.__rsMap.querySourceFeatures('v5-me').length > 0, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__rsMap.getZoom() > 16.5 && !window.__rsMap.isMoving(), null, { timeout: 15000 });
  const at = await view(page);
  check(`${tag}: the locate button shows a dot and flies there`, Math.abs(at.lat - (AREA_N[1] + 0.001)) < 0.0005 && Math.abs(at.lng - (AREA_N[0] + 0.001)) < 0.0005, JSON.stringify(at));

  // the theme can change under the map: the style is swapped, our layers come back, tiles keep coming
  await page.getByRole('combobox', { name: 'Suchen' }).click();
  await page.getByRole('combobox', { name: 'Suchen' }).fill('einst');
  await page.locator('.v5-result').first().click();
  await page.locator('.v5-sheet').waitFor();
  const target = v.theme === 'dark' ? 'Hell' : 'Dunkel';
  await page.getByRole('button', { name: target, exact: true }).click();
  await page.waitForFunction(() => window.__rsMap.isStyleLoaded() && window.__rsDebug().layers >= 17, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Schließen' }).click();
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 17 }), AREA_N);
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-houses-fill'] }).length > 5, null, { timeout: 30000 });
  check(`${tag}: after switching the theme the houses are drawn again`, true);
  await page.screenshot({ path: `${shots}/${tag}-map-theme-switched.png` });

  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();

  // a group link works in its own Gebiet only: the other one is an outline without data
  if (v.width === 390) {
    const editor = await contextAs(browser, 'editor', { viewport: { width: v.width, height: v.height } });
    const p = await editor.newPage();
    const issues = [];
    p.on('pageerror', (e) => issues.push(e.message));
    await p.goto(address);
    await p.waitForSelector('.fm-app', { timeout: 30000 });
    await mapReady(p);
    await p.waitForFunction(() => Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 30000 });
    const mine = Number(await p.locator('.v5-pill').getAttribute('data-total'));
    check(`${tag}: a group link loads only the own Gebiet (fewer houses than the admin)`, mine > 50 && mine < total, `${mine} < ${total}`);
    check(`${tag}: and has the mode button`, (await p.locator('.fm-mode').count()) === 1);
    check(`${tag}: no page errors for the group link`, issues.length === 0, issues.join(' | '));
    await editor.close();
    const viewer = await contextAs(browser, 'viewer', { viewport: { width: v.width, height: v.height } });
    const q = await viewer.newPage();
    await q.goto(address);
    await q.waitForSelector('.fm-app', { timeout: 30000 });
    await mapReady(q);
    check(`${tag}: a viewer link has no mode button and shows the eye`, (await q.locator('.fm-mode').count()) === 0 && (await q.locator('.v5-pill .v5-viewonly').count()) === 1);
    await viewer.close();
  }
}

try {
  for (const v of [VIEWS[0], VIEWS[3]]) await run(v);
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

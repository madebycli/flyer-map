// Marking with the one panel, in every mode, against the local Worker (scripts/rs-e2e/app-local.sh): the places of the panel are the same in all four modes
// (measured), the targets are 44 px, each mode writes operations the server accepts (read back through /state), the undo takes a marking back, and the
// finger tools work with a real touch (CDP touch events) on the phone and with the mouse on the desktop. 390x844 dark and light, 1280x800 dark.
import { VIEWS, counters, launch, mapReady, middleOf, reporter, screenFeatures, shots, tilesDrawn, touchStroke } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs, serverStatuses } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
await buildPacks();
const address = `${APP}?debug&campaign=${CAMPAIGN}`;
const AREA_N = [13.005, 51.005];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOTS = ['mode', 'status', 'context', 'options', 'undo', 'confirm'];

async function run(v) {
  const tag = `${v.width}x${v.height}-${v.theme}`;
  const phone = v.width < 600;
  const context = await contextAs(browser, 'admin', { viewport: { width: v.width, height: v.height }, hasTouch: phone, isMobile: phone });
  if (v.theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  await page.goto(address);
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  await mapReady(page);
  await page.waitForFunction(() => window.__rsApp && Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 40000 });
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 17 }), AREA_N);
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-houses-fill'] }).length > 10, null, { timeout: 30000 });
  // the free band of the screen: under the bar, above the panel (the panel is up from the bottom on a phone, at the right on a desktop)
  const band = phone ? { x0: 20, x1: v.width - 20, y0: 170, y1: 470 } : { x0: 460, x1: 820, y0: 150, y1: 560 };
  const status = (key) => page.evaluate((k) => window.__rsApp.status(k), key);
  const settleSync = () => page.waitForFunction(() => { const s = JSON.parse(window.__rsApp.sync()); return s.state === 'idle' && s.queued === 0; }, null, { timeout: 30000 });
  const choose = (name) => page.locator(`[data-status=${name}]`).click();
  const mode = (name) => page.locator(`[data-mode=${name}]`).click();
  const drag = async (points) => {
    if (phone) return touchStroke(page, points);
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    await sleep(260);
    for (const p of points.slice(1)) { await page.mouse.move(p.x, p.y); await sleep(16); }
    await page.mouse.up();
  };
  const pickHouses = async () => (await screenFeatures(page, 'v5-houses-fill', band)).map((f) => ({ id: f.id, ...middleOf(f) }));
  const rowOf = (houses, n = 3) => {
    for (const h of houses) {
      const row = houses.filter((o) => Math.abs(o.y - h.y) < 10).sort((a, b) => a.x - b.x);
      const spaced = row.filter((o, i) => i === 0 || o.x - row[i - 1].x > 14);
      if (spaced.length >= n) return spaced.slice(0, n);
    }
    return [];
  };

  // the panel opens from the mode button and shows the same places in every mode
  await page.locator('.fm-mode').click();
  await page.locator('.fm-markpanel').waitFor();
  const rectOf = (sel) => page.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10); });
  // measure the six places of the panel in every mode: they have to be the same rectangles
  const measure = async (shotTag) => {
    const places = {};
    for (const m of ['route', 'stamp', 'brush', 'lasso']) {
      await mode(m);
      await page.waitForFunction((name) => document.querySelector('.fm-markpanel').dataset.panelMode === name, m);
      places[m] = { panel: await rectOf('.fm-markpanel') };
      for (const s of SLOTS) places[m][s] = await rectOf(`[data-slot=${s}]`);
      if (shotTag) { await sleep(320); await page.screenshot({ path: `${shots}/${shotTag}-mark-${m}.png` }); }
    }
    return places;
  };
  const same = (places, slot) => ['stamp', 'brush', 'lasso'].every((m) => JSON.stringify(places[m][slot]) === JSON.stringify(places.route[slot]));
  const places = await measure(tag);
  for (const slot of ['panel', ...SLOTS]) check(`${tag}: the place "${slot}" is identical in all four modes`, same(places, slot), JSON.stringify(places.route[slot]));
  check(`${tag}: undo is at the bottom left and confirm at the bottom right`, places.route.undo[0] < places.route.confirm[0] && Math.abs(places.route.undo[1] - places.route.confirm[1]) < 1);
  // the left-handed layout is the mirror image, and again the same in every mode
  await page.locator('[data-quick=hand]').click();
  await page.waitForFunction(() => document.querySelector('.fm-app').dataset.hand === 'left');
  const mirrored = await measure(v.width < 600 && v.theme === 'dark' ? `${tag}-left` : null);
  check(`${tag}: left hand: undo at the bottom right, confirm at the bottom left`, mirrored.route.undo[0] > mirrored.route.confirm[0] && Math.abs(mirrored.route.undo[1] - mirrored.route.confirm[1]) < 1);
  check(`${tag}: left hand: the places are identical in all four modes`, ['panel', ...SLOTS].every((slot) => same(mirrored, slot)));
  check(`${tag}: left hand: the rows keep their height`, mirrored.route.undo[1] === places.route.undo[1] && mirrored.route.status[1] === places.route.status[1]);
  await page.locator('[data-quick=hand]').click();
  await page.waitForFunction(() => document.querySelector('.fm-app').dataset.hand === 'right');
  await mode('route');
  check(`${tag}: the mode button stays where it was while the panel is up`, await page.locator('.fm-mode').evaluate((el) => el.getAttribute('aria-pressed') === 'true'));
  const small = await page.locator('.fm-markpanel button:not([disabled])').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));
  check(`${tag}: every control of the panel is at least 44 px`, small.length === 0, JSON.stringify(small));

  const doneBefore = Number(await page.locator('.v5-pill').getAttribute('data-done'));
  const houses = await pickHouses();
  check(`${tag}: houses are on the screen to work with`, houses.length >= 6, `${houses.length}`);

  // Stempeln: one tap marks one house; a tap on a street marks the street with its houses
  await mode('stamp');
  await choose('completed');
  const h1 = houses[0];
  await page.mouse.click(h1.x, h1.y);
  await page.waitForFunction((k) => window.__rsApp.status(k) === 'completed', h1.id, { timeout: 10000 });
  check(`${tag}: Stempeln: a tap marks the house`, true, h1.id);
  check(`${tag}: and the pill counts it`, Number(await page.locator('.v5-pill').getAttribute('data-done')) === doneBefore + 1);
  const streets = await screenFeatures(page, 'v5-segments-line', band);
  const street = streets.find((s) => s.pts.length >= 2);
  const mid = street.pts[Math.floor(street.pts.length / 2)];
  await page.mouse.click(mid.x, mid.y);
  await page.waitForFunction((k) => window.__rsApp.status(k) === 'completed', street.id, { timeout: 10000 });
  check(`${tag}: Stempeln: a tap on a street marks the piece`, true, street.id);

  // Strecke: tap points along the street, see what the route is, choose a status, confirm
  await mode('route');
  await choose('later');
  const line = streets.filter((s) => s.id !== street.id && s.pts.length >= 3)[0] ?? street;
  const a = line.pts[Math.floor(line.pts.length * 0.2)], b = line.pts[Math.floor(line.pts.length * 0.8)];
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.waitForFunction(() => /Straße/.test(document.querySelector('[data-slot=context]').innerText), null, { timeout: 15000 });
  const sentence = (await page.locator('[data-slot=context]').innerText()).replace(/\s+/g, ' ');
  check(`${tag}: Strecke: the panel says what the route is`, /\d+ Straßen? · \d+ Häuser? · \d+ m/.test(sentence), sentence);
  check(`${tag}: the confirm button counts what it will set`, /Übernehmen · \d+/.test(await page.locator('[data-slot=confirm]').innerText()));
  await page.screenshot({ path: `${shots}/${tag}-mark-route-selected.png` });
  const countBefore = Number(await page.locator('.v5-pill').getAttribute('data-done'));
  await page.locator('[data-slot=confirm]').click();
  await page.waitForFunction((k) => window.__rsApp.status(k) === 'later', line.id, { timeout: 10000 });
  check(`${tag}: Strecke: the confirm sets the status on the route`, true, line.id);
  check(`${tag}: and the points are gone, ready for the next route`, /antippen/.test(await page.locator('[data-slot=context]').innerText()));

  // Wischen: a stroke over a row of houses
  await mode('brush');
  await choose('not-deliverable');
  await page.locator('[data-size=Breit]').click();
  const row = rowOf((await pickHouses()).filter((h) => !['completed', 'later'].includes(h.state)));
  check(`${tag}: a row of houses to paint over`, row.length === 3);
  await drag([row[0], ...Array.from({ length: 12 }, (_, i) => ({ x: row[0].x + ((row[2].x - row[0].x) * (i + 1)) / 12, y: row[0].y }))]);
  await page.waitForFunction((ids) => ids.every((k) => window.__rsApp.status(k) === 'not-deliverable'), row.map((h) => h.id), { timeout: 15000 });
  check(`${tag}: Wischen: the stroke marked the houses under it`, true, row.map((h) => h.id).join(' '));
  await page.screenshot({ path: `${shots}/${tag}-mark-brush-done.png` });

  // Lasso: circle a group of houses
  await mode('lasso');
  await choose('completed');
  const fresh = (await pickHouses()).filter((h) => !row.some((r) => r.id === h.id) && h.id !== h1.id);
  const group = rowOf(fresh, 2);
  check(`${tag}: houses to circle`, group.length === 2);
  const [g0, g1] = group;
  const pad = 20;
  const ring = [{ x: g0.x - pad, y: g0.y - pad }, { x: g1.x + pad, y: g0.y - pad }, { x: g1.x + pad, y: g0.y + pad }, { x: g0.x - pad, y: g0.y + pad }, { x: g0.x - pad, y: g0.y - pad + 2 }];
  const dense = ring.flatMap((p, i) => (i === 0 ? [p] : Array.from({ length: 6 }, (_, k) => ({ x: ring[i - 1].x + ((p.x - ring[i - 1].x) * (k + 1)) / 6, y: ring[i - 1].y + ((p.y - ring[i - 1].y) * (k + 1)) / 6 }))));
  await drag(dense);
  await page.waitForFunction((ids) => ids.every((k) => window.__rsApp.status(k) === 'completed'), group.map((h) => h.id), { timeout: 15000 });
  check(`${tag}: Lasso: the circled houses are marked`, true, group.map((h) => h.id).join(' '));

  // the undo takes the last marking back
  await page.locator('[data-slot=undo]').click();
  await page.waitForFunction((ids) => ids.every((k) => window.__rsApp.status(k) === 'open'), group.map((h) => h.id), { timeout: 15000 });
  check(`${tag}: Rückgängig takes the last marking back`, true);

  // everything reached the server, which accepted it
  await settleSync();
  const server = await serverStatuses();
  // every key the flow touched: the server holds the very status the device shows (the server accepted every operation, the undo included)
  const touched = [h1.id, street.id, line.id, ...row.map((h) => h.id), ...group.map((h) => h.id)];
  const device = await page.evaluate((keys) => keys.map((k) => window.__rsApp.status(k)), touched);
  const differing = touched.filter((k, i) => server[k] !== device[i]);
  check(`${tag}: the server holds what the device marked (read back through /state)`, differing.length === 0 && touched.every((k) => server[k] !== undefined), `${touched.length} keys, ${Object.keys(server).length} in all, differing: ${differing.join(' ')}`);
  check(`${tag}: the undo reached the server too`, group.every((h) => server[h.id] === 'open'));
  const c = await counters(page);
  check(`${tag}: no tile failed on the way`, c.protocol.failed === 0);

  // Fertig ends the marking: the panel goes, the mode button is back to rest
  await mode('stamp');
  await page.locator('[data-slot=confirm]').click();
  await page.locator('.fm-markpanel').waitFor({ state: 'detached' });
  check(`${tag}: "Fertig" puts the tool down`, (await page.locator('.fm-mode').getAttribute('aria-pressed')) === 'false');
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  for (const v of [VIEWS[0], VIEWS[1], VIEWS[2]]) await run(v);
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

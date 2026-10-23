// Drawing Gebiete, against the app's own mock data (?mock=admin: invented Gebiete in a block of four, a backend that stores what is drawn) and the local Worker (a
// connection that cannot store Gebiete yet and says so). Per view: start the tool, tap corners (hints on the way, undo), see the finished outline, name it and
// store it (it shows up in the Studio), an outline over a neighbour is refused in words, connected drawing along a border adds a Gebiet and gives the neighbour
// the two new corners, extending grows a Gebiet, the places of the panel do not move. 390x844 dark/light and 1280x800 dark. Chromium headless only.
import { launch, mapReady, rectOf, screenOf, shots } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs } from './local.mjs';

const { check, failures } = (await import('./lib.mjs')).reporter();
const browser = await launch();
await buildPacks();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(url, v, who) {
  const phone = v.width < 600;
  const options = { viewport: { width: v.width, height: v.height }, hasTouch: phone, isMobile: phone };
  const context = who ? await contextAs(browser, who, options) : await browser.newContext(options);
  if (v.theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  await mapReady(page);
  return { context, page, problems, phone };
}

const gebiete = async (page) => JSON.parse(await page.evaluate(() => window.__rsApp.gebiete()));
const hint = (page) => page.locator('[data-slot=hint] .fm-ctx-line').innerText().then((t) => t.replace(/\s+/g, ' '));
const confirm = (page) => page.locator('[data-slot=confirm]');
/** Put the map where the drawing happens and tap the points (lng, lat) one after the other. */
async function tapAll(page, center, points, zoom = 15.5) {
  await page.evaluate(([c, z]) => window.__rsMap.jumpTo({ center: c, zoom: z }), [center, zoom]);
  await sleep(350);
  for (const [lng, lat] of points) {
    const p = await screenOf(page, lng, lat);
    await page.mouse.click(p.x, p.y);
    await sleep(120);
  }
}

async function start(page, phone) {
  if (phone) {
    await page.locator('.v5-cmd input').click();
    await page.locator('.v5-spot').waitFor();
    await page.locator('.v5-result', { hasText: 'Neues Gebiet zeichnen' }).first().click();
  } else {
    await page.locator('.fm-snew').click();
  }
  await page.locator('.fm-drawpanel').waitFor();
}

async function run(v) {
  const tag = `${v.width}x${v.height}-${v.theme}`;
  const { context, page, problems, phone } = await open(`${APP}?debug&mock=admin`, v);
  await page.waitForFunction(() => window.__rsApp && JSON.parse(window.__rsApp.gebiete()).length === 4, null, { timeout: 30000 });
  const before = await gebiete(page);

  // start: the panel, the kinds, the first sentence
  await start(page, phone);
  const kinds = await page.locator('[data-slot=kind] .fm-tile').allInnerTexts();
  check(`${tag}: the panel offers the kinds of drawing an admin may use`, kinds.join(',') === 'Neu,Anschließen,Erweitern', kinds.join(','));
  check(`${tag}: the mode button is the way out while drawing`, (await page.locator('.fm-mode').getAttribute('aria-pressed')) === 'true');
  check(`${tag}: the first sentence says what to tap`, /Ecken/.test(await hint(page)), await hint(page));
  check(`${tag}: nothing can be confirmed yet`, await confirm(page).isDisabled());
  const bad = await page.locator('.fm-drawpanel button:not([disabled])').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));
  check(`${tag}: every control of the drawing panel is at least 44 px`, bad.length === 0, JSON.stringify(bad));
  await sleep(450); // the panel rises into place first
  const places = { undo: await rectOf(page, '[data-slot=undo]'), confirm: await rectOf(page, '[data-slot=confirm]'), hint: await rectOf(page, '[data-slot=hint]') };

  // a free outline south of the block
  const corners = [[13.006, 51.1980], [13.009, 51.1980], [13.0075, 51.1993]];
  await tapAll(page, [13.0075, 51.1985], corners.slice(0, 2));
  check(`${tag}: two corners: one to go`, /eine Ecke/.test(await hint(page)), await hint(page));
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-going.png` });
  await page.locator('[data-slot=undo]').click();
  check(`${tag}: undo takes the last corner back`, /zwei Ecken/.test(await hint(page)), await hint(page));
  const p = await screenOf(page, ...corners[1]);
  await page.mouse.click(p.x, p.y);
  const q = await screenOf(page, ...corners[2]);
  await page.mouse.click(q.x, q.y);
  await page.waitForFunction(() => document.querySelector('[data-slot=confirm]:not([disabled])'), null, { timeout: 5000 });
  check(`${tag}: three corners make a Gebiet: it says how big it is`, (await page.locator('.fm-draw-size').count()) === 1 && /ca\./.test(await page.locator('.fm-draw-size').innerText()), await page.locator('.fm-draw-size').innerText());
  const filled = await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-draw-fill'] }).length > 0, null, { timeout: 5000 }).then(() => true, () => false);
  check(`${tag}: the outline is filled on the map`, filled);
  const places2 = { undo: await rectOf(page, '[data-slot=undo]'), confirm: await rectOf(page, '[data-slot=confirm]'), hint: await rectOf(page, '[data-slot=hint]') };
  check(`${tag}: the places of the panel did not move`, JSON.stringify(places) === JSON.stringify(places2), JSON.stringify([places, places2]));
  check(`${tag}: undo at the bottom left, confirm at the bottom right`, places2.undo.x < places2.confirm.x && Math.abs(places2.undo.y - places2.confirm.y) < 1);
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-ready.png` });

  // name it and store it
  await confirm(page).click();
  await page.locator('.v5-sheet').waitFor();
  check(`${tag}: a new Gebiet is named in a sheet`, (await page.locator('.v5-sheet header h2').innerText()) === 'Gebiet anlegen');
  check(`${tag}: the name is suggested`, (await page.locator('[data-field=name]').inputValue()) === 'Neues Gebiet 1');
  const groups = await page.locator('[role=radio]').count();
  check(`${tag}: the Gruppen to choose from`, groups >= 2, `${groups}`);
  const small = await page.locator('.v5-sheet button:not([disabled])').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));
  check(`${tag}: every control of the sheet is at least 44 px`, small.length === 0, JSON.stringify(small));
  await page.locator('[data-field=name]').fill('Parkviertel');
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-save.png` });
  await page.locator('.v5-sheet .v5-btn.primary').click();
  await page.locator('.v5-sheet').waitFor({ state: 'detached' });
  const afterNew = await gebiete(page);
  check(`${tag}: the Gebiet is stored with the name`, afterNew.length === 5 && afterNew.some((g) => g.name === 'Parkviertel'), afterNew.map((g) => g.name).join(','));
  check(`${tag}: the drawing tool is put down`, (await page.locator('.fm-drawpanel').count()) === 0 && (await page.locator('.fm-mode').getAttribute('aria-pressed')) === 'false');
  check(`${tag}: a note says so`, /Parkviertel/.test(await page.locator('[data-zone=notice]').innerText()));
  if (!phone) check(`${tag}: and the Studio lists it`, (await page.locator('.fm-srow', { hasText: 'Parkviertel' }).count()) === 1);

  // an outline over a neighbour is refused in words, nothing can be confirmed
  await start(page, phone);
  await tapAll(page, [13.002, 51.2008], [[13.001, 51.2005], [13.003, 51.2005], [13.003, 51.2015]]);
  const refused = await hint(page);
  check(`${tag}: over a neighbour: it says which one`, /liegt über „Altstadt“/.test(refused), refused);
  check(`${tag}: and it cannot be confirmed`, await confirm(page).isDisabled());
  check(`${tag}: the drawing turns red`, (await page.evaluate(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-draw-line'] }).some((f) => f.properties.bad === 1))));
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-refused.png` });
  await page.keyboard.press('Escape');
  await page.locator('.fm-drawpanel').waitFor({ state: 'detached' });
  const gone = await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-draw-line', 'v5-draw-points'] }).length === 0, null, { timeout: 5000 }).then(() => true, () => false);
  check(`${tag}: Escape puts the tool down and the drawing goes`, gone);

  // connected: from the sheet of a Gebiet, along its east border
  await page.evaluate(() => window.__rsMap.jumpTo({ center: [13.0075, 51.2015], zoom: 14 }));
  const hafen = (await gebiete(page)).find((g) => g.id === 'hafen');
  if (phone) {
    await page.locator('.v5-cmd input').click();
    await page.locator('.v5-cmd input').fill('hafenviertel');
    await page.locator('.v5-result').first().click();
  } else {
    await page.locator('.fm-srow', { hasText: 'Hafenviertel' }).click();
  }
  await page.locator('.v5-sheet [data-act=DrawConnect]').click();
  await page.locator('.fm-drawpanel').waitFor();
  check(`${tag}: from the sheet the kind is Anschließen and it knows its Gebiet`, (await page.locator('[data-slot=kind] [aria-pressed=true]').innerText()) === 'Anschließen' && /Hafenviertel/.test(await hint(page)), await hint(page));
  await tapAll(page, [13.0115, 51.2015], [[13.0100, 51.2010], [13.0125, 51.2010], [13.0125, 51.2020], [13.0100, 51.2020]], 15);
  await page.waitForFunction(() => document.querySelector('[data-slot=confirm]:not([disabled])'), null, { timeout: 5000 });
  check(`${tag}: out along the border and back: it is a Gebiet`, /Das passt/.test(await hint(page)), await hint(page));
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-connect.png` });
  await confirm(page).click();
  await page.locator('[data-field=name]').fill('Anbau');
  await page.locator('.v5-sheet .v5-btn.primary').click();
  await page.locator('.v5-sheet').waitFor({ state: 'detached' });
  const afterConnect = await gebiete(page);
  const hafenAfter = afterConnect.find((g) => g.id === 'hafen');
  check(`${tag}: the new Gebiet is stored`, afterConnect.some((g) => g.name === 'Anbau') && afterConnect.length === 6);
  check(`${tag}: the neighbour got the two corners where the new one starts and ends`, hafenAfter.ring.length === hafen.ring.length + 2, `${hafen.ring.length} -> ${hafenAfter.ring.length}`);

  // extending: the Gebiet itself grows
  await page.evaluate(() => window.__rsMap.jumpTo({ center: [13.0025, 51.2015], zoom: 14 }));
  const alt = (await gebiete(page)).find((g) => g.id === 'altstadt');
  if (phone) {
    await page.locator('.v5-cmd input').click();
    await page.locator('.v5-cmd input').fill('altstadt');
    await page.locator('.v5-result').first().click();
  } else {
    await page.locator('.fm-srow', { hasText: 'Altstadt' }).click();
  }
  await page.locator('.v5-sheet [data-act=DrawExtend]').click();
  await page.locator('.fm-drawpanel').waitFor();
  await tapAll(page, [13.0025, 51.1995], [[13.0010, 51.2000], [13.0010, 51.1990], [13.0040, 51.1990], [13.0040, 51.2000]], 15.5);
  await page.waitForFunction(() => document.querySelector('[data-slot=confirm]:not([disabled])'), null, { timeout: 5000 });
  check(`${tag}: extending says what the button will do`, (await confirm(page).innerText()).trim() === 'Erweitern');
  await confirm(page).click();
  await page.waitForFunction(() => /größer/.test(document.querySelector('[data-zone=notice]')?.innerText ?? ''), null, { timeout: 10000 });
  const altAfter = (await gebiete(page)).find((g) => g.id === 'altstadt');
  check(`${tag}: the Gebiet grew by the drawn piece`, altAfter.ring.length > alt.ring.length, `${alt.ring.length} -> ${altAfter.ring.length}`);
  check(`${tag}: and no Gebiet was added`, (await gebiete(page)).length === 6);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function rights(v) {
  const tag = `${v.width}x${v.height}-${v.theme}-rights`;
  const viewer = await open(`${APP}?debug&mock=viewer`, v);
  if (!viewer.phone) check(`${tag}: a viewer is not offered drawing in the Studio`, (await viewer.page.locator('.fm-snew').count()) === 0);
  await viewer.page.locator('.v5-cmd input').click();
  await viewer.page.locator('.v5-cmd input').fill('neues gebiet');
  await sleep(300);
  check(`${tag}: and not as a command`, (await viewer.page.locator('.v5-result', { hasText: 'Neues Gebiet' }).count()) === 0);
  await viewer.context.close();
  const member = await open(`${APP}?debug&mock=member`, v);
  await member.page.locator('.v5-cmd input').click();
  await member.page.locator('.v5-cmd input').fill('neues gebiet');
  await sleep(300);
  check(`${tag}: console is quiet`, viewer.problems.length === 0 && member.problems.length === 0, [...viewer.problems, ...member.problems].join(' | '));
  await member.context.close();
}

async function server(v) {
  const tag = `${v.width}x${v.height}-${v.theme}-server`;
  const { context, page, problems } = await open(`${APP}?debug&campaign=${CAMPAIGN}`, v, 'admin');
  await page.locator('.fm-snew').waitFor();
  await page.locator('.fm-snew').click();
  await page.locator('.fm-drawpanel').waitFor();
  const all = await gebiete(page);
  const east = Math.max(...all.flatMap((g) => g.ring.map((p) => p[0])));
  const north = Math.max(...all.flatMap((g) => g.ring.map((p) => p[1])));
  const pts = [[east + 0.0015, north + 0.0010], [east + 0.0045, north + 0.0010], [east + 0.0030, north + 0.0030]];
  await tapAll(page, [east + 0.003, north + 0.002], pts, 15.5);
  await page.waitForFunction(() => document.querySelector('[data-slot=confirm]:not([disabled])'), null, { timeout: 5000 });
  await confirm(page).click();
  await page.locator('.v5-sheet').waitFor();
  await page.locator('.v5-sheet .v5-btn.primary').click();
  await page.locator('.v5-hint.warn').waitFor();
  const text = await page.locator('.v5-hint.warn').innerText();
  check(`${tag}: a server that cannot store Gebiete says so in the sheet`, /geht mit diesem Server noch nicht/.test(text), text);
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-draw-refused-by-server.png` });
  await page.locator('.v5-sheet .v5-btn.quiet').click();
  await page.locator('.fm-drawpanel').waitFor();
  check(`${tag}: back to the drawing it is still there`, !(await confirm(page).isDisabled()));
  check(`${tag}: nothing was added`, (await gebiete(page)).length === all.length);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  for (const v of [{ width: 390, height: 844, theme: 'dark' }, { width: 390, height: 844, theme: 'light' }, { width: 1280, height: 800, theme: 'dark' }]) await run(v);
  await rights({ width: 390, height: 844, theme: 'dark' });
  await rights({ width: 1280, height: 800, theme: 'dark' });
  await server({ width: 1280, height: 800, theme: 'dark' });
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

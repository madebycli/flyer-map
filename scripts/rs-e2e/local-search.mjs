// Search, the bar and the sheets at the thing, against the local Worker (scripts/rs-e2e/app-local.sh): the card opens on focus with the commands, a typed
// street or address is found (with the letters that matched in bold, typos forgiven), the arrow keys walk the results and Enter opens the sheet at the thing, a
// status chosen in that sheet reaches the server, recents come back on an empty field, a tap on a house on the map opens the same sheet and the map moves the
// house out from under it, a viewer sees neither the marking command nor the status choice. 390x844 dark and light, 1280x800 dark; Chromium headless only.
import { VIEWS, launch, mapReady, middleOf, reporter, screenFeatures, screenOf, shots } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs, serverStatuses } from './local.mjs';

const { check, failures } = reporter();
const browser = await launch();
await buildPacks();
const address = `${APP}?debug&campaign=${CAMPAIGN}`;
const AREA_N = [13.005, 51.005];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(who, v) {
  const phone = v.width < 600;
  const context = await contextAs(browser, who, { viewport: { width: v.width, height: v.height }, hasTouch: phone, isMobile: phone });
  if (v.theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall/.test(m.text())) problems.push(`${m.type()} ${m.text()}`); });
  await page.goto(address);
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  await mapReady(page);
  await page.waitForFunction(() => window.__rsApp && Number(document.querySelector('.v5-pill')?.dataset.total) > 50, null, { timeout: 40000 });
  return { context, page, problems, phone };
}

const field = (page) => page.locator('.v5-cmd input');
const titles = (page) => page.locator('.fm-spot-h').allTextContents();
const firstGroupOf = (page, title) => page.locator('.fm-spot-group', { has: page.locator('.fm-spot-h', { hasText: title }) });
const sheetTitle = (page) => page.locator('.v5-sheet header h2').first().innerText();

async function run(v) {
  const tag = `${v.width}x${v.height}-${v.theme}`;
  const { context, page, problems, phone } = await open('admin', v);
  const input = field(page);

  // focus: the card opens with the commands, nothing was picked yet so there is no "Zuletzt"
  await input.click();
  await page.locator('.v5-spot').waitFor();
  const empty = await titles(page);
  check(`${tag}: the field offers the commands first`, empty.includes('Befehle') && !empty.includes('Zuletzt'), empty.join(','));
  check(`${tag}: the field is a combobox for a listbox`, (await input.getAttribute('role')) === 'combobox' && (await page.locator('.v5-spot').getAttribute('role')) === 'listbox' && (await input.getAttribute('aria-expanded')) === 'true');
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-search-empty.png` });
  if (phone) {
    const r = await page.locator('.v5-spot').evaluate((el) => { const b = el.getBoundingClientRect(); return { bottom: b.bottom, top: b.top }; });
    check(`${tag}: on a phone the card sits low, where the thumb is`, r.bottom > v.height - 40, `bottom ${Math.round(r.bottom)} of ${v.height}`);
  }

  // an address from the map data: type it the way a person would
  const addr = JSON.parse(await page.evaluate(() => window.__rsApp.address(40)));
  const label = `${addr.street} ${addr.number}`;
  await input.fill(label.toLowerCase().replace('ß', 'ss'));
  await page.waitForFunction(() => document.querySelector('.v5-result[data-kind="Haus"]'), null, { timeout: 10000 });
  const groupsTyped = await titles(page);
  check(`${tag}: street and number find the house, houses first for a typed number`, groupsTyped[0] === 'Häuser', groupsTyped.join(','));
  const first = page.locator('.v5-result').first();
  check(`${tag}: the first result is the house`, (await first.locator('b').innerText()) === label, await first.locator('b').innerText());
  const marked = await first.locator('mark').allInnerTexts();
  check(`${tag}: the letters that matched are marked`, marked.length > 0, marked.join('|'));
  await page.screenshot({ path: `${shots}/${tag}-search-house.png` });

  // a typo and a part of a word still find the street
  await input.fill(addr.street.slice(0, 3).toLowerCase());
  await page.waitForFunction((s) => [...document.querySelectorAll('.v5-result[data-kind="Straße"] b')].some((b) => b.innerText === s), addr.street, { timeout: 10000 });
  check(`${tag}: the first letters find the street`, true, addr.street);
  const typo = addr.street.slice(0, -2) + addr.street.slice(-1);
  await input.fill(typo.toLowerCase());
  await page.waitForFunction((s) => [...document.querySelectorAll('.v5-result b')].some((b) => b.innerText.includes(s.slice(0, 3))), typo, { timeout: 10000 });
  check(`${tag}: a letter missing is forgiven`, (await page.locator('.v5-result[data-kind="Straße"]').count()) > 0, typo);
  await input.fill('qqqqqqqq');
  await page.locator('.v5-spot-empty').waitFor();
  check(`${tag}: nothing found says so`, /Nichts gefunden/.test(await page.locator('.v5-spot-empty').innerText()));

  // a command by a few letters
  await input.fill('einst');
  await page.waitForFunction(() => document.querySelector('.v5-result[data-kind="Befehl"]'), null, { timeout: 10000 });
  check(`${tag}: a command is found like everything else`, /Einstellungen/.test(await page.locator('.v5-result').first().innerText()));

  // the arrow keys walk the results; Enter takes the active one
  await input.fill(label.toLowerCase().replace('ß', 'ss'));
  await page.waitForFunction(() => document.querySelector('.v5-result[data-kind="Haus"]'), null, { timeout: 10000 });
  await page.keyboard.press('ArrowDown');
  check(`${tag}: the first arrow moves onto the first result`, (await input.getAttribute('aria-activedescendant')) === 'fm-opt-0' && (await page.locator('#fm-opt-0').getAttribute('data-active')) === 'true');
  const count = await page.locator('.v5-result').count();
  if (count > 1) {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    check(`${tag}: down and up come back`, (await input.getAttribute('aria-activedescendant')) === 'fm-opt-0');
  }
  await page.keyboard.press('Enter');
  await page.locator('.v5-sheet').waitFor();
  await page.locator('.v5-spot').waitFor({ state: 'detached' });
  check(`${tag}: Enter opens the sheet at the thing and closes the card`, (await sheetTitle(page)) === label, await sheetTitle(page));
  await sleep(700);

  // the map brought the house to the free part of the stage
  const free = await page.evaluate(() => {
    const sheet = document.querySelector('.v5-sheet').getBoundingClientRect();
    const view = window.__rsMap.getZoom();
    return { sheetTop: sheet.top, sheetRight: sheet.right, zoom: view };
  });
  check(`${tag}: the map is brought close`, free.zoom >= 17, `zoom ${free.zoom.toFixed(1)}`);
  const status0 = await page.locator('[data-role=status-line]').innerText();
  check(`${tag}: the sheet says what the status is`, /Offen|Ausgeteilt|Später|Nicht möglich/.test(status0), status0);
  check(`${tag}: the sheet offers the four statuses`, (await page.locator('.v5-sheet .fm-tile.status').count()) === 4);
  const small = await page.locator('.v5-sheet button:not([disabled])').evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));
  check(`${tag}: every control of the sheet is at least 44 px`, small.length === 0, JSON.stringify(small));
  await page.screenshot({ path: `${shots}/${tag}-object-house.png` });

  // choosing a status writes it, and the server holds it
  const key = `h:${addr.id}`;
  const before = await serverStatuses();
  await page.locator('.v5-sheet [data-status=completed]').click();
  await page.waitForFunction((k) => window.__rsApp.status(k) === 'completed', key, { timeout: 10000 });
  check(`${tag}: a status chosen in the sheet is set on the house`, true, key);
  check(`${tag}: and the sheet says it`, /Ausgeteilt/.test(await page.locator('[data-role=status-line]').innerText()));
  await page.waitForFunction(() => { const s = JSON.parse(window.__rsApp.sync()); return s.state === 'idle' && s.queued === 0; }, null, { timeout: 30000 });
  const after = await serverStatuses();
  check(`${tag}: the server accepted it`, after[key] === 'completed' && before[key] !== 'completed' || after[key] === 'completed', `${key}: ${before[key] ?? 'none'} -> ${after[key]}`);
  await page.keyboard.press('Escape');
  await page.locator('.v5-sheet').waitFor({ state: 'detached' });
  check(`${tag}: Escape closes the sheet`, true);

  // recents: the thing just opened is on offer first with an empty field
  await input.click();
  await page.locator('.v5-spot').waitFor();
  const again = await titles(page);
  check(`${tag}: what was picked comes back as "Zuletzt"`, again[0] === 'Zuletzt' && (await page.locator('.v5-result').first().locator('b').innerText()) === label, again.join(','));
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-search-recent.png` });
  await page.keyboard.press('Escape');

  // a street: the sheet counts houses and metres, the choice takes the houses along
  await input.fill(addr.street.toLowerCase().replace('ß', 'ss'));
  await page.waitForFunction(() => document.querySelector('.v5-result[data-kind="Straße"]'), null, { timeout: 10000 });
  await page.locator('.v5-result[data-kind="Straße"]').first().click();
  await page.locator('.v5-sheet').waitFor();
  check(`${tag}: a street opens its own sheet`, (await sheetTitle(page)) === addr.street);
  check(`${tag}: with the houses along it on offer`, (await page.locator('.v5-sheet [data-option=houses]').count()) === 1);
  await sleep(500);
  await page.screenshot({ path: `${shots}/${tag}-object-street.png` });
  await page.keyboard.press('Escape');

  // the keyboard shortcut for the search
  await page.locator('.v5-sheet').waitFor({ state: 'detached' }).catch(() => {});
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('/');
  check(`${tag}: "/" puts the cursor in the search`, await page.evaluate(() => document.activeElement?.matches('.v5-cmd input')));
  await page.keyboard.press('Escape');

  // a tap on a house on the map opens the same sheet
  await page.evaluate(([lng, lat]) => window.__rsMap.jumpTo({ center: [lng, lat], zoom: 17 }), AREA_N);
  await page.waitForFunction(() => window.__rsMap.queryRenderedFeatures({ layers: ['v5-houses-fill'] }).length > 10, null, { timeout: 30000 });
  await sleep(300);
  const band = phone ? { x0: 20, x1: v.width - 20, y0: Math.round(v.height * 0.58), y1: Math.round(v.height * 0.72) } : { x0: 500, x1: 800, y0: 200, y1: 560 };
  const houses = (await screenFeatures(page, 'v5-houses-fill', band)).map((f) => ({ id: f.id, ...middleOf(f) }));
  check(`${tag}: houses on the screen to tap`, houses.length >= 1, `${houses.length}`);
  const target = houses[0];
  const where = await page.evaluate(([x, y]) => { const r = document.querySelector('[data-fm-map]').getBoundingClientRect(); const c = window.__rsMap.unproject([x - r.x, y - r.y]); return [c.lng, c.lat]; }, [target.x, target.y]);
  await page.mouse.click(target.x, target.y);
  await page.locator('.v5-sheet').waitFor();
  check(`${tag}: a tap on a house opens its sheet`, (await page.locator('.v5-sheet .fm-tile.status').count()) === 4, await sheetTitle(page));
  await sleep(800);
  const moved = await screenOf(page, where[0], where[1]);
  const sheetBox = await page.locator('.v5-sheet').boundingBox();
  const hidden = phone ? moved.y > sheetBox.y - 8 : moved.x < sheetBox.x + sheetBox.width + 8 && moved.y > sheetBox.y;
  check(`${tag}: the map moved the house out from under the sheet`, !hidden, `house at ${Math.round(moved.x)},${Math.round(moved.y)}, sheet from ${Math.round(sheetBox.x)},${Math.round(sheetBox.y)}`);
  await page.locator('.v5-sheet [data-status=later]').click();
  await page.waitForFunction((k) => window.__rsApp.status(k) === 'later', `h:${target.id.replace(/^h:/, '')}`, { timeout: 10000 }).catch(() => {});
  const laterOk = await page.evaluate((id) => ['later'].includes(window.__rsApp.status(`h:${id.replace(/^h:/, '')}`)), target.id);
  check(`${tag}: the status chosen after a tap is set`, laterOk, target.id);
  await page.screenshot({ path: `${shots}/${tag}-object-tapped.png` });

  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function viewer(v) {
  const tag = `${v.width}x${v.height}-${v.theme}-viewer`;
  const { context, page, problems } = await open('viewer', v);
  const input = field(page);
  await input.click();
  await page.locator('.v5-spot').waitFor();
  const offered = (await page.locator('.v5-result').allInnerTexts()).join(' ');
  check(`${tag}: a viewer is not offered marking`, !/Markieren/.test(offered), offered.replace(/\s+/g, ' ').slice(0, 120));
  const addr = JSON.parse(await page.evaluate(() => window.__rsApp.address(40)));
  await input.fill(`${addr.street} ${addr.number}`.toLowerCase().replace('ß', 'ss'));
  await page.waitForFunction(() => document.querySelector('.v5-result[data-kind="Haus"]'), null, { timeout: 10000 });
  await page.keyboard.press('Enter');
  await page.locator('.v5-sheet').waitFor();
  check(`${tag}: the sheet of a house shows no status choice`, (await page.locator('.v5-sheet .fm-tile.status').count()) === 0);
  check(`${tag}: and says it is for looking`, /ansehen/.test(await page.locator('.v5-sheet').innerText()));
  await page.screenshot({ path: `${shots}/${tag}-object-house.png` });
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  for (const v of [VIEWS[0], VIEWS[1], VIEWS[2]]) await run(v);
  await viewer(VIEWS[0]);
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

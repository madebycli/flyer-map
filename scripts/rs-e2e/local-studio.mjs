// The Studio, against the app's own mock data (?mock=<persona>, invented people and invitations) and against the local Worker (real Gebiete, a connection that
// does not serve people and access yet): the column at 1280x800, the sheet on a phone (opened from the bar), tabs by mouse, touch and arrow keys, rows that open the
// sheet of the thing and show it on the map, what the rights hide, 44 px targets. Chromium headless only.
import { launch, mapReady, reporter, rectOf, shots } from './lib.mjs';
import { APP, CAMPAIGN, buildPacks, contextAs } from './local.mjs';

const { check, failures } = reporter();
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
  return { context, page, problems };
}

const tabs = (page) => page.locator('[role=tab]').allTextContents();
const small = (page, scope) => page.locator(`${scope} button:not([disabled])`).evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)).filter((m) => m < 43.5));

async function desktop(v, tag) {
  const { context, page, problems } = await open(`${APP}?debug&mock=admin`, v);
  await page.locator('.fm-studio [role=tab]').first().waitFor();
  const studio = await rectOf(page, '.fm-studio');
  const stage = await rectOf(page, '.fm-stage');
  check(`${tag}: the Studio is a column next to the map, not over it`, studio.width > 300 && Math.abs(studio.x + studio.width - stage.x) < 1 && stage.width + studio.width <= v.width + 1, `${Math.round(studio.width)} + ${Math.round(stage.width)}`);
  const names = await tabs(page);
  check(`${tag}: an admin has five tabs`, names.length === 5 && /Gebiete/.test(names[0]) && /Zugänge/.test(names[4]), names.join(' | '));
  const rows = await page.locator('.fm-srow').count();
  check(`${tag}: the Gebiete are listed`, rows >= 3, `${rows}`);
  check(`${tag}: a Gebiet row says its Gruppe`, /Gruppe/.test(await page.locator('.fm-srow').first().innerText()));
  check(`${tag}: the Gebiete tab offers drawing a new one`, (await page.locator('.fm-snew').count()) === 1);
  const bad = await small(page, '.fm-studio');
  check(`${tag}: every control of the Studio is at least 44 px`, bad.length === 0, JSON.stringify(bad));
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-studio-gebiete.png` });

  // arrow keys move between the tabs
  await page.locator('[role=tab][aria-selected=true]').focus();
  await page.keyboard.press('ArrowRight');
  check(`${tag}: ArrowRight moves to the next tab`, (await page.locator('[role=tab][aria-selected=true]').getAttribute('data-tab')) === 'gruppen');
  check(`${tag}: a Gruppe counts its Gebiete`, /Gebiet/.test(await page.locator('.fm-srow').first().innerText()));
  await page.keyboard.press('ArrowRight');
  check(`${tag}: and the Läufe, who is out`, (await page.locator('.fm-srow').count()) >= 1 && /Personen?/.test(await page.locator('.fm-srow').first().innerText()));
  await page.locator('[data-tab=personen]').click();
  check(`${tag}: people with their role and last seen`, (await page.locator('.fm-srow').count()) >= 2 && /zuletzt/.test(await page.locator('.fm-srow').first().innerText()));
  await sleep(300);
  await page.screenshot({ path: `${shots}/${tag}-studio-personen.png` });
  await page.locator('[data-tab=zugaenge]').click();
  check(`${tag}: invitations say how often they were used`, /genutzt/.test(await page.locator('.fm-slist').innerText()));

  // a row opens the sheet of the thing and the map shows it
  await page.locator('[data-tab=gebiete]').click();
  const before = await page.evaluate(() => { const c = window.__rsMap.getCenter(); return [c.lng, c.lat, window.__rsMap.getZoom()]; });
  const second = page.locator('.fm-srow').nth(2);
  const name = (await second.locator('b').innerText()).trim();
  await second.click();
  await page.locator('.v5-sheet').waitFor();
  await sleep(600);
  const after = await page.evaluate(() => { const c = window.__rsMap.getCenter(); return [c.lng, c.lat, window.__rsMap.getZoom()]; });
  check(`${tag}: a Gebiet row opens its sheet`, (await page.locator('.v5-sheet header h2').innerText()) === name, name);
  check(`${tag}: and the map goes there`, Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]) > 1e-5 || Math.abs(after[2] - before[2]) > 0.05);
  const sheet = await rectOf(page, '.v5-sheet');
  check(`${tag}: the sheet sits at the left of the stage, next to the column`, sheet.x >= studio.x + studio.width - 1 && sheet.x < studio.x + studio.width + 40, `${Math.round(sheet.x)}`);
  await page.screenshot({ path: `${shots}/${tag}-studio-sheet.png` });
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function rights(v, tag) {
  const { context, page, problems } = await open(`${APP}?debug&mock=member`, v);
  await page.locator('.fm-studio [role=tab]').first().waitFor();
  const names = await tabs(page);
  check(`${tag}: a member has no people and no access tab`, names.length === 3 && !names.some((n) => /Personen|Zugänge/.test(n)), names.join(' | '));
  await context.close();
  const viewer = await open(`${APP}?debug&mock=viewer`, v);
  await viewer.page.locator('.fm-studio [role=tab]').first().waitFor();
  check(`${tag}: a viewer cannot draw`, (await viewer.page.locator('.fm-snew').count()) === 0);
  await viewer.context.close();
  check(`${tag}: console is quiet`, problems.length === 0 && viewer.problems.length === 0, [...problems, ...viewer.problems].join(' | '));
}

async function realServer(v, tag) {
  const { context, page, problems } = await open(`${APP}?debug&campaign=${CAMPAIGN}`, v, 'admin');
  await page.locator('.fm-studio [role=tab]').first().waitFor();
  check(`${tag}: the real Gebiete are listed`, (await page.locator('.fm-srow').count()) >= 2);
  await page.locator('[data-tab=personen]').click();
  const text = await page.locator('.fm-slist').innerText();
  check(`${tag}: a list this server does not give says so instead of looking empty`, /noch nicht/.test(text), text.replace(/\s+/g, ' ').slice(0, 90));
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

async function phone(v, tag) {
  const { context, page, problems } = await open(`${APP}?debug&mock=admin`, v);
  check(`${tag}: no column on a phone`, (await page.locator('.fm-studio').count()) === 0);
  await page.locator('.v5-cmd input').click();
  await page.locator('.v5-spot').waitFor();
  const offered = await page.locator('.v5-result b').allInnerTexts();
  check(`${tag}: the Studio is one of the commands`, offered.includes('Studio'), offered.join(','));
  await page.locator('.v5-result', { hasText: 'Studio' }).first().click();
  await page.locator('.v5-sheet [role=tab]').first().waitFor();
  const bad = await small(page, '.v5-sheet');
  check(`${tag}: every control of the sheet is at least 44 px`, bad.length === 0, JSON.stringify(bad));
  await sleep(400);
  await page.screenshot({ path: `${shots}/${tag}-studio-sheet-phone.png` });
  await page.locator('[data-tab=laeufe]').click();
  await page.locator('.fm-srow').first().click();
  await page.locator('.v5-sheet header h2').waitFor();
  check(`${tag}: a row opens the sheet of the thing`, /Ben/.test(await page.locator('.v5-sheet header h2').innerText()), await page.locator('.v5-sheet header h2').innerText());
  check(`${tag}: a Lauf can be followed`, (await page.locator('.v5-sheet [data-act=Follow]').count()) === 1);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  await desktop({ width: 1280, height: 800, theme: 'dark' }, '1280x800-dark');
  await desktop({ width: 1280, height: 800, theme: 'light' }, '1280x800-light');
  await rights({ width: 1280, height: 800, theme: 'dark' }, '1280x800-dark-rights');
  await realServer({ width: 1280, height: 800, theme: 'dark' }, '1280x800-dark-server');
  await phone({ width: 390, height: 844, theme: 'dark' }, '390x844-dark');
  await phone({ width: 390, height: 844, theme: 'light' }, '390x844-light');
} finally {
  await browser.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

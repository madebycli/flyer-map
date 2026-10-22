// Browser flow of the app shell on the mock backend (flyermap-web, `?mock=` personas): build first with scripts/rs-web-build.sh, then
//   node scripts/rs-e2e/shell.mjs
// Proves the zones, the three anchors (command bar, quick bar, mode button), the live strip, the sheets at the thing and the Studio column
// at 390x844 and 1280x800, dark and light, with a quiet console.
import { fileURLToPath } from 'node:url';
import { serve } from '../rs-web-serve.mjs';
import { VIEWS, launch, mapReady, noOverflow, openPage, rectOf, reporter, screenOf, settle, shots, withDebug } from './lib.mjs';

// a tap on the Gebiet Nordstadt (its middle), as a finger would: through the map
const tapNordstadt = async (page) => { const p = await screenOf(page, 13.0025, 51.20425); await page.mouse.click(p.x, p.y); };

const PORT = 8151;
const BASE = `http://127.0.0.1:${PORT}/`;
const server = await serve(fileURLToPath(new URL('../../dist-rs/', import.meta.url)), PORT);
const browser = await launch();
const { check, failures } = reporter();

async function run(view) {
  const { width, height, theme } = view;
  const tag = `${width}x${height}-${theme}`;
  const wide = width >= 900;
  const { context, page, problems } = await openPage(browser, view);
  const button = (name) => page.getByRole('button', { name, exact: true });
  const sheet = page.locator('.v5-sheet');
  const t0 = Date.now();
  await page.goto(withDebug(BASE));
  await page.waitForSelector('.fm-app', { timeout: 30000 });
  check(`${tag}: the app starts`, true, `${Date.now() - t0} ms`);
  check(`${tag}: the start screen leaves the document`, await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 4000 }).then(() => true, () => false));
  check(`${tag}: the theme is ${theme}`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme);
  check(`${tag}: no horizontal overflow`, await noOverflow(page));
  await mapReady(page);

  // zones: the stage holds the map and the six zones, nothing else floats
  const kids = await page.locator('.fm-stage > *').evaluateAll((els) => els.map((e) => e.dataset.zone ?? (e.classList.contains('v5-map') ? 'map' : `?${e.className}`)));
  check(`${tag}: the stage holds the map and exactly the six zones`, JSON.stringify([...kids].sort()) === JSON.stringify(['bottom', 'map', 'notice', 'overlay', 'panel', 'sheet', 'top']), kids.join(','));

  // layout: the Studio is a column from 900 px, nothing before
  check(`${tag}: layout is ${wide ? 'wide' : 'compact'}`, (await page.locator('.fm-app').getAttribute('data-layout')) === (wide ? 'wide' : 'compact'));
  check(`${tag}: the Studio column ${wide ? 'is' : 'is not'} there`, (await page.locator('.fm-studio').count()) === (wide ? 1 : 0));
  if (wide) check(`${tag}: the stage starts after the column`, (await rectOf(page, '.fm-stage')).x >= 399);

  // top: one bar of 56 px, then the live strip with who is out
  const bar = await rectOf(page, '.v5-cmd');
  check(`${tag}: the command bar is one line of 56 px at the top`, Math.abs(bar.height - 56) < 1 && bar.y < 40, JSON.stringify(bar));
  check(`${tag}: there is no menu button`, (await page.getByRole('button', { name: 'Menü' }).count()) === 0);
  const chips = page.locator('.fm-live .fm-chip');
  check(`${tag}: the live strip shows two Läufe`, (await chips.count()) === 2);
  check(`${tag}: and no old "Admin" or "Runs" wording`, !/Admin|Runs/.test(await page.locator('[data-zone=top]').innerText()));
  await page.screenshot({ path: `${shots}/${tag}-map.png` });

  // targets of 44 px and up
  const small = await page.locator('.fm-qbtn, .fm-mode, .fm-chip, .v5-pill, .v5-cmd-clear').evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }).filter((m) => m < 43.5));
  check(`${tag}: every anchor is a target of at least 44 px`, small.length === 0, JSON.stringify(small));

  // quick bar: five buttons, the hand flips the sides
  const quick = page.locator('.fm-quick [data-quick]');
  check(`${tag}: the quick bar has its five buttons`, (await quick.evaluateAll((els) => els.map((e) => e.dataset.quick))).join() === 'locate,base,hand,feedback,sync');
  const modeBefore = await rectOf(page, '.fm-mode'), quickBefore = await rectOf(page, '.fm-quick');
  check(`${tag}: right-handed: the mode button is on the right, the quick bar on the left`, modeBefore.x > quickBefore.x);
  await page.locator('[data-quick=hand]').click();
  check(`${tag}: the hand switches`, (await page.locator('.fm-app').getAttribute('data-hand')) === 'left');
  const modeAfter = await rectOf(page, '.fm-mode'), quickAfter = await rectOf(page, '.fm-quick');
  check(`${tag}: left-handed: the sides swap and the buttons keep their size`, modeAfter.x < quickAfter.x && modeAfter.width === modeBefore.width, `${Math.round(modeBefore.x)} -> ${Math.round(modeAfter.x)}`);
  check(`${tag}: the switch says what it did`, await page.locator('.v5-toast').innerText().then((t) => t.includes('links'), () => false));
  await page.locator('[data-quick=hand]').click();
  const feelings = [];
  for (let i = 0; i < 4; i++) { await page.locator('[data-quick=feedback]').click(); feelings.push(await page.locator('[data-quick=feedback]').getAttribute('aria-label')); }
  check(`${tag}: buzz and tone go round through four states`, new Set(feelings).size === 4, feelings.join(' | '));

  // a tap on a Gebiet opens its sheet, with its actions
  await tapNordstadt(page);
  await sheet.waitFor();
  await settle(page, '.v5-sheet');
  check(`${tag}: a Gebiet opens a sheet with its name`, (await sheet.getAttribute('aria-label')) === 'Nordstadt');
  const acts = await page.locator('.fm-act').allInnerTexts();
  check(`${tag}: the admin gets the Gebiet's actions, not a menu of everything`, acts.length >= 3 && acts.length <= 5 && acts.includes('Lauf starten'), acts.join(' | '));
  await page.screenshot({ path: `${shots}/${tag}-gebiet-sheet.png` });
  await button('Schließen').click();
  await sheet.waitFor({ state: 'detached' });

  // the live strip: a tap follows a Lauf and opens its sheet, a second tap lets go
  await chips.first().click();
  await sheet.waitFor();
  check(`${tag}: a chip follows the Lauf and opens its sheet`, (await chips.first().getAttribute('aria-pressed')) === 'true' && (await sheet.getAttribute('aria-label')) === 'Ben +2');
  await button('Schließen').click();
  await chips.first().click();
  check(`${tag}: a second tap lets go`, (await chips.first().getAttribute('aria-pressed')) === 'false');

  // search: suggestions when empty, names when typed, commands that open sheets
  const field = page.getByRole('textbox', { name: 'Suchen' });
  await field.click();
  await page.locator('.v5-spot').waitFor();
  const offered = await page.locator('.v5-result b').allInnerTexts();
  check(`${tag}: an empty field offers the commands`, offered.length === (wide ? 3 : 4) && offered.includes('Einstellungen'), offered.join(', '));
  const barBefore = await rectOf(page, '.v5-cmd');
  await field.fill('nord');
  const found = await page.locator('.v5-result').allInnerTexts();
  check(`${tag}: a few letters find a Gebiet, a Gruppe and a Lauf`, found.length === 3, found.join(' | ').replace(/\n/g, ' '));
  check(`${tag}: the bar keeps its place while the card is open`, JSON.stringify(barBefore) === JSON.stringify(await rectOf(page, '.v5-cmd')));
  await settle(page, '.v5-spot');
  await page.screenshot({ path: `${shots}/${tag}-search.png` });
  await field.fill('einst');
  await page.locator('.v5-result').first().click();
  await sheet.waitFor();
  check(`${tag}: the command "Einstellungen" opens the settings`, (await sheet.getAttribute('aria-label')) === 'Einstellungen');
  await button('Schließen').click();
  await sheet.waitFor({ state: 'detached' });

  // a viewer may only look: no mode button, one action
  const viewer = await openPage(browser, view);
  await viewer.page.goto(withDebug(BASE, 'mock=viewer'));
  await viewer.page.waitForSelector('.fm-app', { timeout: 30000 });
  check(`${tag}: a viewer has no mode button`, (await viewer.page.locator('.fm-mode').count()) === 0);
  await mapReady(viewer.page);
  await tapNordstadt(viewer.page);
  await viewer.page.locator('.v5-sheet').waitFor();
  check(`${tag}: and one action on a Gebiet: look`, (await viewer.page.locator('.fm-act').allInnerTexts()).join() === 'Auf der Karte zeigen');
  check(`${tag}: the pill shows the eye of a viewer`, (await viewer.page.locator('.v5-pill .v5-viewonly').count()) === 1);
  check(`${tag}: viewer console is quiet`, viewer.problems.length === 0, viewer.problems.join(' | '));
  await viewer.context.close();

  // the theme and the hand survive a reload
  await context.setOffline(false);
  await page.reload();
  await page.waitForSelector('.fm-app');
  check(`${tag}: after a reload the theme is still ${theme}`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme);
  check(`${tag}: console is quiet`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  for (const view of VIEWS) await run(view);
} finally {
  await browser.close();
  server.close();
}
const n = failures();
console.log(n === 0 ? `\nall checks passed (screenshots in ${shots})` : `\n${n} checks failed`);
process.exit(n === 0 ? 0 : 1);

// Browser flow of the Rust shell (flyermap-web, fake data): build first with scripts/rs-web-build.sh, then
//   node scripts/rs-e2e/shell.mjs
// Env: CHROMIUM_PATH (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome), PLAYWRIGHT_CORE (module path), SHOTS_DIR (screenshots;
// default <tmp>/flyermap-rs-e2e, never the repository).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '../rs-web-serve.mjs';

const pw = await import(process.env.PLAYWRIGHT_CORE ?? '/opt/node-tools/node_modules/playwright-core/index.js');
const { chromium } = pw.default ?? pw;
const PORT = 8151;
const BASE = `http://127.0.0.1:${PORT}/`;
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'flyermap-rs-e2e');
mkdirSync(shots, { recursive: true });
const server = await serve(fileURLToPath(new URL('../../dist-rs/', import.meta.url)), PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--no-proxy-server'] });

let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); if (!ok) failures++; };

async function run({ width, height, theme }) {
  const tag = `${width}x${height}-${theme}`;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (theme === 'light') await context.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('vf-v5-theme', 'light'); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()} ${m.text()}`); });
  const sheet = page.locator('.v5-sheet');
  const settle = () => sheet.evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
  const token = (n) => page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), n);
  const rect = (sel) => page.locator(sel).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  const button = (name) => page.getByRole('button', { name, exact: true });

  const t0 = Date.now();
  await page.goto(BASE);
  await page.waitForSelector('.v5-pill', { timeout: 20000 });
  check(`${tag}: the shell starts`, true, `${Date.now() - t0} ms to the pill`);
  await page.waitForFunction(() => document.getElementById('splash')?.classList.contains('done'));
  check(`${tag}: the theme is ${theme}`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme);

  const pill = page.locator('button.v5-pill');
  const done = Number(await pill.getAttribute('data-done')), total = Number(await pill.getAttribute('data-total'));
  check(`${tag}: the pill carries data-done and data-total`, Number.isInteger(done) && Number.isInteger(total) && total > 0 && done <= total, `${done}/${total}`);
  check(`${tag}: no horizontal overflow on the map`, await noOverflow());
  await page.screenshot({ path: `${shots}/${tag}-map.png` });

  // search: the card floats under the bar, the bar does not move
  const barBefore = await rect('.v5-cmd');
  check(`${tag}: the bar is one line of 56 px at the top`, Math.abs(barBefore.height - 56) < 1 && barBefore.y < 40, JSON.stringify(barBefore));
  const field = page.getByRole('textbox', { name: 'Straße oder Adresse suchen' });
  await field.click();
  await field.fill('haupt');
  await page.locator('.v5-spot').waitFor();
  const barAfter = await rect('.v5-cmd'), card = await rect('.v5-spot');
  check(`${tag}: the results card appears under the bar`, card.y >= barAfter.y + barAfter.height && (await page.locator('.v5-result').count()) > 1, JSON.stringify(card));
  check(`${tag}: the bar keeps its place and size while the card is open`, JSON.stringify(barBefore) === JSON.stringify(barAfter), `${JSON.stringify(barBefore)} -> ${JSON.stringify(barAfter)}`);
  await page.screenshot({ path: `${shots}/${tag}-search.png` });
  await field.fill('xyzzy');
  check(`${tag}: nothing found says so`, await page.locator('.v5-spot-empty').isVisible());
  await page.keyboard.press('Escape');
  await page.locator('.v5-spot').waitFor({ state: 'detached' });
  check(`${tag}: Escape closes the card and empties the field`, (await field.inputValue()) === '');

  // menu
  await button('Menü').click();
  await sheet.waitFor();
  await settle();
  const rows = await page.locator('.v5-sheet .v5-grow').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check(`${tag}: the menu opens with its rows, every row at least 44 px`, rows.length >= 10 && rows.every((h) => h >= 44), JSON.stringify(rows));
  check(`${tag}: the mode switch is a group of pressed buttons`, (await page.getByRole('group', { name: 'Modus' }).getByRole('button', { name: 'Austeilen' }).getAttribute('aria-pressed')) === 'true');
  check(`${tag}: no horizontal overflow with the menu`, await noOverflow());
  const radii = await sheet.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius].map(parseFloat); });
  if (width >= 600) check(`${tag}: the sheet is rounded on all four corners`, radii.every((r) => r >= 12), JSON.stringify(radii));
  else check(`${tag}: the sheet is rounded at the top`, radii[0] >= 12 && radii[1] >= 12, JSON.stringify(radii));
  await page.screenshot({ path: `${shots}/${tag}-menu.png` });
  await page.getByRole('group', { name: 'Modus' }).getByRole('button', { name: 'Abholen' }).click();
  check(`${tag}: collecting swaps the manage rows`, (await button('Einrichten').count()) === 1 && (await button('Gruppen').count()) === 0);
  await page.getByRole('group', { name: 'Modus' }).getByRole('button', { name: 'Austeilen' }).click();

  // the handle shrinks the sheet to its header and brings it back
  const full = await rect('.v5-sheet');
  await page.locator('.v5-handle').click();
  check(`${tag}: tapping the handle shrinks the sheet`, (await sheet.getAttribute('class')).includes('small') && (await rect('.v5-sheet')).height < full.height * 0.5);
  await page.locator('.v5-handle').click();
  check(`${tag}: tapping it again brings it back`, !(await sheet.getAttribute('class')).includes('small'));

  // settings: appearance, switches
  await button('Einstellungen').click();
  await page.getByRole('heading', { name: 'Einstellungen' }).waitFor();
  check(`${tag}: settings have a back arrow`, (await page.locator('.v5-sheet').getByRole('button', { name: 'Zurück' }).count()) === 1);
  const other = theme === 'dark' ? 'Hell' : 'Dunkel', otherTheme = theme === 'dark' ? 'light' : 'dark';
  await button(other).click();
  check(`${tag}: the segmented choice switches data-theme`, (await page.evaluate(() => document.documentElement.dataset.theme)) === otherTheme && (await button(other).getAttribute('aria-pressed')) === 'true');
  await button(theme === 'dark' ? 'Dunkel' : 'Hell').click();
  check(`${tag}: and back`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme);
  const awake = page.getByRole('switch', { name: 'Bildschirm anlassen' });
  const before = await awake.getAttribute('aria-checked');
  await awake.click();
  check(`${tag}: a setting is a switch (role=switch) that flips aria-checked`, (await page.getByRole('switch').count()) === 3 && before === 'true' && (await awake.getAttribute('aria-checked')) === 'false');
  check(`${tag}: and is stored with the key of the React app`, (await page.evaluate(() => localStorage.getItem('vf-awake'))) === 'off');
  await awake.click();
  await settle();
  await page.screenshot({ path: `${shots}/${tag}-settings.png` });

  // colour: one level further down, back arrows up again
  await button('Farbe').click();
  await page.getByRole('group', { name: 'Grundfarbe' }).waitFor();
  await settle();
  const swatches = await page.locator('.v5-swatch').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  check(`${tag}: eight colours and an own one, each at least 44 px`, swatches.length === 9 && swatches.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(swatches));
  const primary = await token('--primary');
  await button('Blau').click();
  check(`${tag}: choosing Blau changes --primary`, (await token('--primary')) !== primary && (await button('Blau').getAttribute('aria-pressed')) === 'true', `${primary} -> ${await token('--primary')}`);
  check(`${tag}: no horizontal overflow in the colour sheet`, await noOverflow());
  await page.screenshot({ path: `${shots}/${tag}-palette.png` });
  await button('Smaragd').click();
  check(`${tag}: Smaragd is the default again`, (await token('--primary')) === primary && (await page.evaluate(() => localStorage.getItem('vf-v5-seed'))) === null);
  await page.locator('.v5-sheet').getByRole('button', { name: 'Zurück' }).click();
  check(`${tag}: back from the colour is the settings`, await page.getByRole('heading', { name: 'Einstellungen' }).isVisible());
  await page.locator('.v5-sheet').getByRole('button', { name: 'Zurück' }).click();
  check(`${tag}: back from the settings is the menu`, await page.getByRole('heading', { name: 'Menü' }).isVisible());

  // help
  await button('Hilfe').click();
  await page.getByLabel('Fragen durchsuchen').waitFor();
  const all = await page.locator('.v5-faqitem').count();
  await page.getByLabel('Fragen durchsuchen').fill('lasso');
  const some = await page.locator('.v5-faqitem').count();
  check(`${tag}: the help search narrows the questions`, all > 10 && some >= 1 && some < all, `${all} -> ${some}`);
  await page.locator('.v5-faqitem summary').first().click();
  check(`${tag}: a question opens on tap`, await page.locator('.v5-faqitem[open] p').first().isVisible());
  await page.locator('.v5-sheet').getByRole('button', { name: 'Schließen' }).click();
  await sheet.waitFor({ state: 'detached' });
  check(`${tag}: closing returns to the map`, (await page.locator('.v5-root').getAttribute('data-ui')) === 'idle');

  // overview from the pill
  await pill.click();
  await sheet.waitFor();
  await settle();
  const text = await sheet.innerText();
  check(`${tag}: the overview counts houses and says how`, text.includes('Der Fortschritt zählt Häuser. „Nicht möglich“ wird von der Gesamtzahl abgezogen.') && (await page.getByRole('progressbar', { name: 'Fortschritt nach Häusern' }).count()) === 1);
  const pct = Number(await page.getByRole('progressbar').getAttribute('aria-valuenow'));
  check(`${tag}: the overview percent is the pill's`, Math.round((done / total) * 100) === pct, `${done}/${total} -> ${pct}`);
  await page.screenshot({ path: `${shots}/${tag}-overview.png` });
  await page.locator('.v5-sheet').getByRole('button', { name: 'Schließen' }).click();

  // a row without a screen yet says so in a note
  await button('Menü').click();
  await button('Notizen').click();
  check(`${tag}: a missing screen shows a note under the bar`, await page.locator('.v5-toast').isVisible());
  await page.locator('.v5-toast').getByRole('button', { name: 'OK' }).click();

  // a reload keeps the choices before the first paint
  await page.evaluate(() => localStorage.setItem('vf-v5-seed', '#2f6bd8'));
  await page.reload();
  await page.waitForSelector('.v5-pill');
  check(`${tag}: after a reload theme and colour are still there`, (await page.evaluate(() => document.documentElement.dataset.theme)) === theme && (await token('--primary')) !== primary);
  check(`${tag}: no errors or warnings in the console`, problems.length === 0, problems.join(' | '));
  await context.close();
}

try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) for (const theme of ['dark', 'light']) await run({ ...viewport, theme });
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : `\nall checks passed (screenshots in ${shots})`);
process.exit(failures ? 1 : 0);

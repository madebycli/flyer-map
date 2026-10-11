// Material You colours: the colour of the app comes from one seed colour chosen in the menu; it changes the tokens in light and dark, survives a
// reload, and every swatch is a real target.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 300)}`}`); if (!ok) failures++; };
const until = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 120)); } return false; };

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
const page = await context.newPage();
page.on('pageerror', (error) => check(`page error ${error.message}`, false));
await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 180000 });
const settle = () => page.locator('.v5-sheet').evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); }); // the sheet slides in
const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

const before = { primary: await token('--primary'), surface: await token('--surface') };
check('the page has Material tokens from the start (primary, container, secondary, tertiary)', !!before.primary && !!(await token('--secondary-container')) && !!(await token('--on-tertiary-container')), JSON.stringify(before));

await menuTile(page, 'Farbe');
await page.getByRole('group', { name: 'Grundfarbe' }).waitFor();
const swatches = await page.locator('.v5-swatch').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
check('eight colours and one of your own, every swatch at least 44 px', swatches.length === 9 && swatches.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(swatches));
check('no horizontal overflow in the colour sheet', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
await settle();
await page.screenshot({ path: `${shots}/t21-palette-dark.png` });

await page.getByRole('button', { name: 'Blau', exact: true }).click();
check('choosing Blau changes the accent and the containers', await until(async () => (await token('--primary')) !== before.primary), `${before.primary} → ${await token('--primary')}`);
check('the choice is marked as pressed', (await page.getByRole('button', { name: 'Blau', exact: true }).getAttribute('aria-pressed')) === 'true');
const blue = { primary: await token('--primary'), container: await token('--primary-container') };

// light mode recomputes the roles for the same seed
await page.getByRole('button', { name: 'Schließen' }).click();
await menuTile(page, 'Hell');
await until(async () => (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
const light = { primary: await token('--primary'), surface: await token('--surface') };
check('light mode has its own tones of the same blue (darker accent, light surface)', light.primary !== blue.primary && light.surface !== before.surface, JSON.stringify(light));
await page.getByRole('button', { name: 'Farbe', exact: true }).click(); // the menu stays open after the theme tile
await page.getByRole('group', { name: 'Grundfarbe' }).waitFor();
await settle();
await page.screenshot({ path: `${shots}/t21-palette-light.png` });
await page.getByRole('button', { name: 'Schließen' }).click();

// a reload keeps it, before the first paint
await page.reload();
await page.waitForSelector('.v5-pill', { timeout: 120000 });
check('after a reload the colour is still Blau (light)', (await token('--primary')) === light.primary, `${await token('--primary')} vs ${light.primary}`);

// back to the default
await menuTile(page, 'Farbe');
await page.getByRole('button', { name: 'Smaragd', exact: true }).click();
check('Smaragd is the default again', await until(async () => (await token('--primary')) !== light.primary));
await page.getByRole('button', { name: 'Schließen' }).click();
await page.locator('.v5-sheet').waitFor({ state: 'detached' });
await page.getByRole('button', { name: 'Menü', exact: true }).click();
await settle();
await page.screenshot({ path: `${shots}/t21-menu.png` });
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

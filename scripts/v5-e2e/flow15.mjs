// Mobile clarity: two changed sheets, 390/430 px × dark/light × left/right, against real Worker handlers.
// Run via run-all.mjs after npm run build; SHOTS_DIR is optional and is created here.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { encodeClock } from '../../src/v5/store/hlc.ts';
import { menuTile } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const until = async (fn, ms = 8000) => { const deadline = Date.now() + ms; while (Date.now() < deadline) { if (await fn()) return true; await new Promise((resolve) => setTimeout(resolve, 100)); } return false; };
const touchSize = async (locator) => locator.evaluateAll((elements) => elements.length > 0 && elements.every((element) => { const box = element.getBoundingClientRect(); return box.width >= 44 && box.height >= 44; }));
const noOverflow = async (page) => page.evaluate(() => { const sheet = document.querySelector('.v5-sheet'); return document.documentElement.scrollWidth <= innerWidth && sheet.scrollWidth <= sheet.clientWidth + 1; });
const settledSheet = async (page) => page.locator('.v5-sheet').evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });

try {
  for (const width of [390, 430]) for (const theme of ['dark', 'light']) for (const hand of ['left', 'right']) {
    const tag = `${width}-${theme}-${hand}`;
    const context = await browser.newContext({ viewport: { width, height: 932 } });
    await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
    await context.addInitScript(({ theme, hand }) => { localStorage.setItem('vf-v5-theme', theme); localStorage.setItem('vf-v5-hand', hand); }, { theme, hand });
    const page = await context.newPage();
    page.on('pageerror', (error) => check(`${tag}: page error ${error.message}`, false));
    const ghost = `h:ghost-mobile-${tag}`;
    const realKey = 'h:h5000000';
    const seed = await context.request.post(`${BASE}/api/v5/campaigns/campaign_n/ops`, { data: { ops: [ghost, realKey].map((key, counter) => ({ id: encodeClock({ wall: Date.now(), counter, node: 'mobile' }), key, status: 'completed', area: 'area_n' })) } });
    check(`${tag}: seed real and obsolete progress through handler`, seed.status() === 200);
    await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug`);
    await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
    await page.waitForSelector('.v5-pill', { timeout: 120000 }).catch(async (error) => {
      await page.screenshot({ path: `${shots}/boot-error-${tag}.png` });
      console.log(`${tag}: boot failed: ${(await page.locator('body').innerText()).slice(0, 600)}`);
      throw error;
    });
    await page.waitForFunction(() => window.__v5Map?.getLayer('v5-segments-line'), null, { timeout: 60000 });
    check(`${tag}: requested theme and hand applied`, await page.evaluate(({ theme, hand }) => document.documentElement.dataset.theme === theme && document.querySelector('.v5-root').dataset.hand === hand, { theme, hand }));

    await menuTile(page, 'Gebiete');
    await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
    await page.waitForTimeout(1200);
    const point = await page.evaluate(() => { const point = window.__v5Map.project([13.0075, 51.0045]); return { x: point.x, y: point.y }; });
    await page.mouse.click(point.x, point.y);
    const prune = page.getByRole('button', { name: 'Veraltete Einträge dieses Gebiets bereinigen', exact: true });
    await prune.waitFor();
    const removeArea = page.getByRole('button', { name: 'Gebiet löschen', exact: true });
    check(`${tag}: different actions have visible captions`, (await prune.innerText()) === 'Veraltete Einträge bereinigen' && (await removeArea.innerText()) === 'Gebiet löschen');
    check(`${tag}: area sheet has no horizontal overflow`, await noOverflow(page));
    check(`${tag}: both action targets are at least 44 px`, await touchSize(prune) && await touchSize(removeArea));
    check(`${tag}: area inputs have at least 16 px text`, await page.locator('.v5-sheet input').evaluateAll((elements) => elements.length > 0 && elements.every((element) => parseFloat(getComputedStyle(element).fontSize) >= 16)));
    await settledSheet(page);
    await page.screenshot({ path: `${shots}/area-${tag}.png` });
    page.once('dialog', async (dialog) => { check(`${tag}: cleanup confirmation explains all devices`, /alle Geräte/.test(dialog.message())); await dialog.accept(); });
    await prune.click();
    check(`${tag}: last obsolete entry clears and control disappears immediately`, await until(async () => (await prune.count()) === 0, 1500));
    check(`${tag}: singular success message`, await until(async () => /1 veralteter Eintrag entfernt\./.test(await page.locator('.v5-toast').innerText().catch(() => ''))));
    const state = await (await context.request.get(`${BASE}/api/v5/campaigns/campaign_n/state?since=0&limit=1000`)).json();
    const meta = await (await context.request.get(`${BASE}/api/v5/campaigns/campaign_n/meta`)).json();
    check(`${tag}: cleanup preserves Gebiet and real progress`, meta.areas.some((area) => area.id === 'area_n') && state.ops.some((op) => op.key === realKey && op.status === 'completed') && state.ops.some((op) => op.key === ghost && op.status === 'open'));
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await page.getByRole('button', { name: 'Schließen', exact: true }).click();

    await menuTile(page, 'Zugänge');
    const group = page.getByRole('group', { name: 'Sonder-Marker-Rechte von Nutzer 2', exact: true });
    await group.waitFor();
    await group.scrollIntoViewIfNeeded();
    check(`${tag}: all four rights have visible text`, JSON.stringify(await group.getByRole('button').allInnerTexts()) === JSON.stringify(['Sehen', 'Anlegen', 'Bearbeiten', 'Zuweisen']));
    check(`${tag}: all four right targets are at least 44 px`, await touchSize(group.getByRole('button')));
    check(`${tag}: right captions are not clipped`, await group.locator('button span').evaluateAll((elements) => elements.length === 4 && elements.every((element) => element.scrollWidth <= element.clientWidth)));
    check(`${tag}: rights sheet has no horizontal overflow`, await noOverflow(page));
    const collectors = async () => (await (await context.request.get(`${BASE}/api/campaigns/campaign_n/collection/collectors`)).json()).collectors;
    const before = await collectors();
    const target = before.find((collector) => collector.label === 'Nutzer 2');
    const other = before.find((collector) => collector.label === 'Nutzer 1');
    const create = group.getByRole('button', { name: 'Nutzer 2: Anlegen', exact: true });
    // Tab really reaches the switch; Space exercises the same real handler as a tap.
    await create.focus();
    await page.keyboard.press('Tab');
    check(`${tag}: keyboard moves to next named right`, await group.getByRole('button', { name: 'Nutzer 2: Bearbeiten', exact: true }).evaluate((element) => document.activeElement === element));
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    check(`${tag}: keyboard toggle is saved only for chosen helper`, await until(async () => { const now = await collectors(); return now.find((collector) => collector.id === target.id)?.collectionCapabilities.canCreatePickups === !target.collectionCapabilities.canCreatePickups && JSON.stringify(now.find((collector) => collector.id === other.id)?.collectionCapabilities) === JSON.stringify(other.collectionCapabilities); }));
    check(`${tag}: pressed state matches saved right`, await until(async () => (await create.getAttribute('aria-pressed')) === String(!target.collectionCapabilities.canCreatePickups)));
    await group.scrollIntoViewIfNeeded();
    await settledSheet(page);
    await page.screenshot({ path: `${shots}/rights-${tag}.png` });
    await create.click();
    check(`${tag}: tap switches right back off/on`, await until(async () => (await collectors()).find((collector) => collector.id === target.id)?.collectionCapabilities.canCreatePickups === target.collectionCapabilities.canCreatePickups));
    await context.close();
  }
} finally { await browser.close(); }
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

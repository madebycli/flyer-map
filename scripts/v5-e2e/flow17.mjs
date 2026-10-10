// UI audit of every sheet: 390/430 px × dark/light. For each sheet: no sideways scrolling, every control at least 44 px, every control named,
// one vertical rhythm (direct children of a sheet 16 px apart; 8 px after a heading or the handle, before the status hint), and a screenshot.
// Run via run-all.mjs after npm run build; screenshots go to SHOTS_DIR/audit-*.png.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { menuTile } from './ui.mjs';

const BASE = 'http://localhost:8140';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];

/** Everything this audit measures about the open sheet, in one pass inside the page. */
const measure = (page) => page.locator('.v5-sheet').evaluate((sheet) => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.innerText || el.innerText || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText) || el.closest('label')?.innerText || el.getAttribute('placeholder') || '').trim();
  const controls = [...sheet.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href], [role=button], summary')].filter(visible);
  // A checkbox or radio is measured by its label (the whole row is the target).
  const target = (el) => (el.matches('input[type=checkbox], input[type=radio]') ? el.closest('label') ?? el : el);
  const small = controls.map((el) => { const r = target(el).getBoundingClientRect(); return { el, w: r.width, h: r.height }; }).filter(({ w, h }) => w < 43.5 || h < 43.5)
    .map(({ el, w, h }) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}「${name(el).slice(0, 24)}」${Math.round(w)}×${Math.round(h)}`);
  const unnamed = controls.filter((el) => !name(el)).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`);
  const kids = [...sheet.children].filter(visible);
  const gaps = [];
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1], b = kids[i];
    const gap = Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
    const tight = a.tagName === 'H3' || a.classList.contains('v5-handle') || b.classList.contains('v5-statushint');
    const want = tight ? 8 : 16;
    if (Math.abs(gap - want) > 1) gaps.push(`${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} → ${b.tagName.toLowerCase()}.${String(b.className).split(' ')[0]}: ${gap}px (soll ${want})`);
  }
  // Icon colour against its own background (non-text contrast, at least 3 : 1) for the note flags.
  const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return c.startsWith('color(') ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const faint = [...sheet.querySelectorAll('.v5-flag')].filter(visible).map((el) => { const s = getComputedStyle(el); return { el, r: ratio(rgb(s.color), rgb(s.backgroundColor)) }; })
    .filter(({ r }) => r < 3).map(({ el, r }) => `${el.getAttribute('aria-label')} ${r.toFixed(2)}:1`);
  // A control's caption that the browser cuts off (ellipsis or hidden overflow) is unreadable: "Nicht mögli…".
  const clipped = controls.flatMap((el) => [el, ...el.querySelectorAll('*')]).filter((el) => visible(el) && el.childElementCount === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth && getComputedStyle(el).overflowX !== 'visible')
    .map((el) => `「${el.textContent.trim().slice(0, 30)}」`);
  return { clipped, faint, overflow: Math.max(sheet.scrollWidth - sheet.clientWidth, document.documentElement.scrollWidth - innerWidth), small, unnamed, gaps };
});

const audit = async (page, tag, sheet) => {
  await page.locator('.v5-sheet').waitFor({ timeout: 10000 });
  await page.locator('.v5-sheet').evaluate(async (el) => { await Promise.all(el.getAnimations().map((a) => a.finished)); });
  const m = await measure(page);
  check(`${tag} ${sheet}: no sideways scrolling`, m.overflow <= 1, m.overflow);
  check(`${tag} ${sheet}: every control at least 44 px`, m.small.length === 0, m.small.join(' · '));
  check(`${tag} ${sheet}: every control has a name`, m.unnamed.length === 0, m.unnamed.join(' · '));
  check(`${tag} ${sheet}: one vertical rhythm`, m.gaps.length === 0, m.gaps.join(' · '));
  check(`${tag} ${sheet}: no control caption is cut off`, m.clipped.length === 0, m.clipped.join(' · '));
  check(`${tag} ${sheet}: note flag icons at least 3 : 1 against their background`, m.faint.length === 0, m.faint.join(' · '));
  await page.screenshot({ path: `${shots}/audit-${tag}-${sheet}.png` });
};
const close = (page) => page.locator('.v5-sheet').getByRole('button', { name: 'Schließen' }).first().click().catch(() => {});

const open = async (width, theme, query = '') => {
  const context = await browser.newContext({ viewport: { width, height: 932 } });
  await context.addCookies([{ name: 'vf_session', value: cookies.admin, url: BASE }]);
  await context.addInitScript((t) => { localStorage.setItem('vf-v5-theme', t); }, theme);
  const page = await context.newPage();
  page.on('pageerror', (error) => check(`page error ${error.message}`, false));
  await page.goto(`${BASE}/v5.html?campaign=campaign_n&debug${query}`);
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 180000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  return { context, page };
};

try {
  for (const width of [390, 430]) for (const theme of ['dark', 'light']) {
    const tag = `${width}-${theme}`;
    const { context, page } = await open(width, theme);
    for (const [tile, sheet] of [['Übersicht', 'overview'], ['Team', 'team'], ['Gruppen', 'groups'], ['Zugänge', 'access'], ['Suche', 'search'], ['Notizen', 'notes'], ['Diagnose', 'diag']]) {
      await menuTile(page, tile);
      await audit(page, tag, sheet);
      await close(page);
    }
    // A house and a street: tap them on the map.
    await page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(76, 87), 18.4]);
    const house = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(76, 87));
    await page.mouse.click(house[0], house[1]);
    await audit(page, tag, 'house');
    await close(page);
    // Gebiete: the area sheet of the first Area.
    await menuTile(page, 'Gebiete');
    await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
    await page.waitForTimeout(800);
    const area = await page.evaluate(() => { const p = window.__v5Map.project([13.0075, 51.0045]); return [p.x, p.y]; });
    await page.mouse.click(area[0], area[1]);
    await audit(page, tag, 'area');
    await close(page);
    await context.close();

    // Abholen: the setup sheet and the collection Areas.
    const coll = await open(width, theme, '&kind=collection');
    await menuTile(coll.page, 'Einrichten');
    await audit(coll.page, tag, 'setup');
    await close(coll.page);
    await menuTile(coll.page, 'Gebiete');
    await audit(coll.page, tag, 'collection-areas');
    await coll.context.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

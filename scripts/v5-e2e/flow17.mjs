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
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
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
  const body = sheet.querySelector('.v5-sheet-body') ?? sheet;
  const kids = [...body.children].filter(visible);
  const gaps = [];
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1], b = kids[i];
    const gap = Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
    const tight = a.tagName === 'H3' || b.classList.contains('v5-statushint');
    const want = tight ? 8 : 16;
    if (Math.abs(gap - want) > 1) gaps.push(`${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} → ${b.tagName.toLowerCase()}.${String(b.className).split(' ')[0]}: ${gap}px (soll ${want})`);
  }
  // Icon colour against its own background (non-text contrast, at least 3 : 1) for the note flags.
  const rgb = (c) => { const m = c.match(/[\d.]+/g).map(Number); return c.startsWith('color(') ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const faint = [...sheet.querySelectorAll('.v5-flag, .v5-note-ico')].filter(visible).map((el) => { const s = getComputedStyle(el); return { el, r: ratio(rgb(s.color), rgb(s.backgroundColor)) }; })
    .filter(({ r }) => r < 3).map(({ el, r }) => `${el.getAttribute('aria-label')} ${r.toFixed(2)}:1`);
  // A control's caption that the browser cuts off (ellipsis or hidden overflow) is unreadable: "Nicht mögli…".
  const clipped = controls.flatMap((el) => {
    const box = el.getBoundingClientRect();
    const spills = [...el.querySelectorAll('*')].filter(visible).some((child) => { const r = child.getBoundingClientRect(); return r.left < box.left - 1 || r.right > box.right + 1; });
    const cut = [el, ...el.querySelectorAll('*')].some((node) => node.textContent.trim() && node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX !== 'visible' && node.clientWidth > 0);
    return spills || cut ? [`「${el.textContent.trim().slice(0, 30)}」`] : [];
  });
  return { clipped, faint, overflow: Math.max(sheet.scrollWidth - sheet.clientWidth, body.scrollWidth - body.clientWidth, document.documentElement.scrollWidth - innerWidth), small, unnamed, gaps };
});

const audit = async (page, tag, sheet) => {
  await page.locator('.v5-sheet').waitFor({ timeout: 10000 });
  // Measure the sheet with its data, not its placeholder.
  const loaded = await until(async () => !/Lade …|wird geladen|Lädt/.test(await page.locator('.v5-sheet').innerText().catch(() => 'Lade …')), 10000);
  check(`${tag} ${sheet}: content loaded before measuring`, loaded);
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
const close = async (page, what) => {
  await page.locator('.v5-sheet').getByRole('button', { name: 'Schließen' }).first().click();
  check(`${what}: the sheet closes`, await until(async () => (await page.locator('.v5-sheet').count()) === 0, 5000));
};

const open = async (width, theme, query = '') => {
  const context = await browser.newContext({ viewport: { width, height: width > 700 ? 900 : 932 } });
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
  for (const [width, theme] of [[390, 'dark'], [390, 'light'], [430, 'dark'], [430, 'light'], [1280, 'dark']]) {
    const tag = `${width}-${theme}`;
    const { context, page } = await open(width, theme);
    await menuTile(page, 'Hilfe');
    await audit(page, tag, 'help');
    await close(page, `${tag} help`);
    for (const [tile, sheet] of [['Übersicht', 'overview'], ['Team', 'team'], ['Gruppen', 'groups'], ['Zugänge', 'access'], ['Vorlagen', 'templates'], ['Notizen', 'notes'], ['Einstellungen', 'settings'], ['Diagnose', 'diag'], ['Runs', 'runs'], ['Farbe', 'palette']]) {
      await menuTile(page, tile);
      await audit(page, tag, sheet);
      await close(page, `${tag} ${sheet}`);
    }
    if (tag === '390-dark') {
      // Räume: the form to open one, the open room, and (the next rounds) the record with a finished run
      await menuTile(page, 'Runs');
      await page.getByRole('button', { name: 'Raum öffnen', exact: true }).click();
      await page.getByRole('group', { name: 'Wer darf beitreten' }).waitFor();
      await audit(page, tag, 'room-start');
      await page.getByRole('textbox', { name: 'Personenzahl' }).fill('8');
      await page.locator('.v5-sheet').getByRole('button', { name: 'Raum öffnen', exact: true }).click();
      await page.getByRole('timer', { name: 'Laufzeit des Raums' }).waitFor();
      await audit(page, tag, 'room');
      await page.getByRole('button', { name: /Wer darf beitreten\? ändern/ }).click();
      await audit(page, tag, 'room-mode');
      page.once('dialog', (d) => void d.accept());
      await page.getByRole('button', { name: 'Run beenden' }).click();
      await page.getByText('Run beendet').waitFor();
      await audit(page, tag, 'room-summary');
      await page.getByRole('button', { name: 'Fertig' }).click(); // back to the list, which now holds the finished run
      await page.locator('.v5-sheet').getByText('Alle Runs').waitFor();
      await audit(page, tag, 'runs-record');
      await close(page, `${tag} runs-record`);
    }
    // A house and a street: tap them on the map.
    await page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(76, 87), 18.4]);
    const house = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(76, 87));
    await page.mouse.click(house[0], house[1]);
    await audit(page, tag, 'house');
    await close(page, `${tag} house`);
    // Gebiete: the area sheet of the first Area.
    await menuTile(page, 'Gebiete');
    await page.evaluate(() => window.__v5Map.fitBounds([[12.9965, 50.9958], [13.0245, 51.0125]], { padding: 40, duration: 0 }));
    await page.waitForTimeout(800);
    const area = await page.evaluate(() => { const p = window.__v5Map.project([13.0075, 51.0045]); return [p.x, p.y]; });
    await page.mouse.click(area[0], area[1]);
    await audit(page, tag, 'area');
    await close(page, `${tag} area`);
    await context.close();

    // Abholen: the setup sheet and the collection Areas.
    const coll = await open(width, theme, '&kind=collection');
    await menuTile(coll.page, 'Einrichten');
    await audit(coll.page, tag, 'setup');
    await close(coll.page, `${tag} setup`);
    await menuTile(coll.page, 'Gebiete');
    await audit(coll.page, tag, 'collection-areas');
    await coll.context.close();
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

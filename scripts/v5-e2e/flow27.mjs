// Fast marking tools and the Area editor, against the real handlers (v5 API + legacy mutation endpoint).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
import { confirmRoute, menuTile, setBrush, setMode, startMarking } from './ui.mjs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const shots = process.env.SHOTS_DIR ?? new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
const boot = async () => {
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug' + (process.env.V5_QUERY ?? ''));
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 5000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 120000 });
  await page.waitForFunction(() => window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 60000 });
  await page.waitForTimeout(1200);
};
const done = async () => Number(await page.locator('.v5-pill').getAttribute('data-done'));
const jump = (x, y, zoom) => page.evaluate(async ([c, z]) => { const m = window.__v5Map; m.jumpTo({ center: c, zoom: z }); await new Promise((r) => m.once('idle', r)); }, [M(x, y), zoom]);
const scr = (x, y) => page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y));
const clickAt = async (x, y) => { const [sx, sy] = await scr(x, y); await page.mouse.click(sx, sy); };
const serverStatus = (key) => page.evaluate(async (k) => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=1000')).json()).ops.find((o) => o.key === k)?.status ?? 'open', key);
const until = async (predicate, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await predicate()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const drag = async (points) => { const first = await scr(...points[0]); await page.mouse.move(...first); await page.mouse.down(); await page.waitForTimeout(260); /* Wischen / Lasso take a finger that rests a moment */ for (const p of points.slice(1)) { const [sx, sy] = await scr(...p); await page.mouse.move(sx, sy, { steps: 14 }); } await page.mouse.up(); };

// Wischen as a highlighter: a see-through stroke as wide as the brush follows the finger, everything under it is marked, in both directions, streets whole.
await boot();
const segOps = () => page.evaluate(async () => (await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=5000')).json()).ops.filter((o) => o.key.startsWith('s:')).map((o) => [o.key, o.status]));
await startMarking(page);
await setMode(page, 'Wischen');
await setBrush(page, 'Ausgeteilt');
await jump(100, 0, 18.1); // the screen shows about 37 m either side

// 1. the stroke is visible while the finger is down and its width is the brush's
{
  const [x0, y0] = await scr(75, 0), [x1, y1] = await scr(125, 0);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.waitForTimeout(260);
  await page.mouse.move(x1, y1, { steps: 16 });
  await page.waitForTimeout(250);
  // the ink is a canvas in screen pixels: its thickness in the middle of the stroke is the brush's (44 px, "Mittel")
  const stroke = await page.evaluate(() => {
    const c = document.querySelector('canvas.v5-ink'); if (!c) return { n: 0 };
    const g = c.getContext('2d'), dpr = c.width / c.clientWidth, x = Math.round(c.width / 2);
    const col = g.getImageData(x, 0, 1, c.height).data; let rows = 0;
    for (let y = 0; y < c.height; y++) if (col[y * 4 + 3] > 0) rows++;
    return { n: rows, thickness: Math.round(rows / dpr), opacity: getComputedStyle(c).opacity };
  });
  check('while painting, a see-through stroke is drawn, as thick as the brush', stroke.n > 0 && Math.abs(stroke.thickness - 44) <= 3 && Math.abs(Number(stroke.opacity) - 0.42) < 0.05, JSON.stringify(stroke));
  await page.screenshot({ path: `${shots}/t3-highlighter.png` });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
const first = await segOps();
// 2. the whole stretch under the stroke is marked, with no gap between its pieces
const keysFirst = first.map((e) => e[0]);
check('the street under the stroke is marked piece by piece', first.length >= 4 && first.every((e) => e[1] === 'completed'), `${first.length} pieces`);

// 3. the other direction marks the same pieces (a different status makes the overlap visible)
await setBrush(page, 'Später');
await drag([[125, 0], [75, 0]]);
await page.waitForTimeout(700);
const back = await segOps();
const laterKeys = back.filter((e) => e[1] === 'later').map((e) => e[0]);
check('painting the same stretch the other way round marks the same pieces', keysFirst.every((k) => laterKeys.includes(k)), `${keysFirst.length} → ${laterKeys.length}`);

// 1b. a curvy, doubling-back stroke has no fans, spikes or patches: no ink further from the finger's path than the brush radius, and no gap inside it
{
  await setMode(page, 'Wischen');
  await setBrush(page, 'Nicht möglich');
  const path = [];
  for (let i = 0; i <= 60; i++) { const t = i / 60 * Math.PI * 4; const [x, y] = await scr(100 + 16 * Math.cos(t * 0.5) + 6 * Math.sin(t), 14 * Math.sin(t * 0.5) + 4 * Math.cos(t * 1.5)); path.push([x, y]); }
  await page.mouse.move(path[0][0], path[0][1]); await page.mouse.down(); await page.waitForTimeout(260);
  for (const [x, y] of path) await page.mouse.move(x, y, { steps: 2 });
  await page.waitForTimeout(250);
  const res = await page.evaluate((pathPts) => {
    const c = document.querySelector('canvas.v5-ink'); if (!c) return { bad: -1 };
    const g = c.getContext('2d'), dpr = c.width / c.clientWidth, d = g.getImageData(0, 0, c.width, c.height).data;
    const rect = c.getBoundingClientRect(), R = 22;
    const dist = (px, py) => { let best = 1e9; for (let i = 0; i + 1 < pathPts.length; i++) { const [ax, ay] = pathPts[i], [bx, by] = pathPts[i + 1]; const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l)); best = Math.min(best, Math.hypot(px - ax - t * vx, py - ay - t * vy)); } return best; };
    let outside = 0, hole = 0, alphas = new Set();
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) {
      const a = d[(y * c.width + x) * 4 + 3], q = dist(x / dpr + rect.left, y / dpr + rect.top);
      if (a > 0 && q < R - 3) alphas.add(a); // the inside of the stroke: one value, edges are anti-aliased
      if (a > 0 && q > R + 2) outside++;
      if (a === 0 && q < R - 2) hole++;
    }
    return { outside, hole, alphas: alphas.size };
  }, path);
  check('a curvy stroke paints only the brush width around the finger path', res.outside === 0, JSON.stringify(res));
  check('and leaves no gaps inside it', res.hole === 0, JSON.stringify(res));
  check('and is one even colour (no darker patches where it crosses itself)', res.alphas === 1, JSON.stringify(res));
  await page.screenshot({ path: `${shots}/t3-curvy.png` });
  // every house with a corner well inside the stroke is one the person painted over: it has to be marked afterwards
  const painted = await page.evaluate((pathPts) => {
    const m = window.__v5Map, R = 22 - 5;
    const dist = (px, py) => { let best = 1e9; for (let i = 0; i + 1 < pathPts.length; i++) { const [ax, ay] = pathPts[i], [bx, by] = pathPts[i + 1]; const vx = bx - ax, vy = by - ay, l = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l)); best = Math.min(best, Math.hypot(px - ax - t * vx, py - ay - t * vy)); } return best; };
    const rect = m.getCanvas().getBoundingClientRect(), ids = new Set();
    for (const f of m.queryRenderedFeatures({ layers: ['v5-houses-fill'] })) {
      const rings = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
      if (rings.some((ring) => ring.some((c) => { const q = m.project(c); return dist(q.x + rect.left, q.y + rect.top) <= R; }))) ids.add(String(f.id));
    }
    return [...ids];
  }, path);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const markedList = await page.evaluate(async () => ((await (await fetch('/api/v5/campaigns/campaign_n/state?since=0&limit=5000')).json()).ops.filter((o) => o.key.startsWith('h:') && o.status === 'not-deliverable').map((o) => o.key)));
  const marked = new Set(markedList);
  const missed = painted.filter((id) => !marked.has(id));
  check('every house the stroke really covers is marked afterwards', painted.length > 0 && missed.length === 0, `${painted.length} painted, ${missed.length} missed`);
}

// 4. the lasso outline is ink on the same canvas: a closed figure-of-eight style loop is drawn without map-layer artefacts, filled by the rule the engine selects by (even-odd)
{
  await setMode(page, 'Lasso');
  const loop = [[85, -10], [115, -10], [100, 10], [85, 10], [115, 10], [100, -10], [85, -10]];
  const first = await scr(...loop[0]);
  await page.mouse.move(...first); await page.mouse.down(); await page.waitForTimeout(260);
  for (const p of loop.slice(1)) { const q = await scr(...p); await page.mouse.move(q[0], q[1], { steps: 8 }); }
  await page.waitForTimeout(250);
  const lasso = await page.evaluate(() => {
    const c = document.querySelector('canvas.v5-ink'); if (!c) return { drawn: 0 };
    const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let drawn = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) drawn++;
    const layerFeatures = window.__v5Map.queryRenderedFeatures({ layers: ['v5-draw-fill', 'v5-draw-line'].filter((id) => window.__v5Map.getLayer(id)) }).length;
    return { drawn, opacity: getComputedStyle(c).opacity, layerFeatures };
  });
  check('while lassoing, the outline and fill are ink on the canvas, nothing in map layers', lasso.drawn > 500 && lasso.layerFeatures === 0 && lasso.opacity === '1', JSON.stringify(lasso));
  await page.screenshot({ path: `${shots}/t3-lasso.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const gone = await page.evaluate(() => { const c = document.querySelector('canvas.v5-ink'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false; return true; });
  check('and the lasso ink is gone once the finger is lifted', gone);
}

await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

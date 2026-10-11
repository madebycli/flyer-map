// Performance probe (not part of run-all): a big city with a lot of marked houses, measured the way a phone would feel it.
// Usage: CITY_BLOCKS=55 MARKS=49000 CPU=4 node scripts/v5-e2e/perf.mjs   (starts its own fixture server; needs npm run build)
// It reports: the first start (fetch + derive) and the second one (from the device cache), the main-thread long tasks and frame times while the
// map is panned and zoomed at several zoom levels, and with CPU=PROFILE=1 the functions that cost the most main-thread time.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const dir = new URL('.', import.meta.url).pathname;
const BLOCKS = process.env.CITY_BLOCKS ?? '55', MARKS = Number(process.env.MARKS ?? 49000), CPU = Number(process.env.CPU ?? 4);
fs.rmSync(`${dir}cookies.json`, { force: true });
const server = spawn('node', ['--experimental-transform-types', `${dir}server.ts`], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, CITY_BLOCKS: BLOCKS } });
await new Promise((resolve) => server.stdout.on('data', (chunk) => String(chunk).includes('READY') && resolve()));
const cookies = JSON.parse(fs.readFileSync(`${dir}cookies.json`, 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server'] });
const ctx = await b.newContext({ viewport: { width: 411, height: 776 }, hasTouch: true, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const log = (...a) => console.log(...a);
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(label) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERROR', e.message));
  await page.addInitScript(() => { window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {} });
  const t0 = Date.now();
  await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
  await page.getByText('Kartendaten fehlen').waitFor({ timeout: 6000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
  await page.waitForSelector('.v5-pill', { timeout: 600000 });
  await page.waitForFunction(() => window.__v5Boot && window.__v5Map && (window.__v5Map.getSource('v5-tiles') || window.__v5Map.getSource('v5-houses')), null, { timeout: 120000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('[role=status]')].some((e) => /Weitere Kartendaten/.test(e.textContent ?? '')), null, { timeout: 300000 });
  const boot = await page.evaluate(() => window.__v5Boot);
  const houses = await page.locator('.v5-pill').getAttribute('data-total');
  log(`${label}: ${Date.now() - t0} ms until the map works; boot`, JSON.stringify(boot), 'houses', houses);
  return page;
}

// ── first start, then the cached one ──
let page = await open('FIRST START ');
// ── marks: a lot of houses done, written through the API like a team that worked for days ──
if (MARKS) {
  const { syntheticCity } = await import('../../src/v5/engine/synthetic.ts');
  const { encodeClock } = await import('../../src/v5/store/hlc.ts');
  const city = syntheticCity(Number(BLOCKS), Number(BLOCKS));
  const keys = city.raw.buildings.map((x) => `h:h${x.id}`).slice(0, MARKS);
  const wall = Date.now() - 3_600_000;
  let sent = 0;
  for (let i = 0; i < keys.length; i += 200) {
    const ops = keys.slice(i, i + 200).map((key, j) => ({ id: encodeClock({ wall: wall + i + j, counter: 0, node: 'perf' }), key, status: j % 7 === 0 ? 'later' : 'completed', area: 'area_n' }));
    const r = await fetch('http://localhost:8140/api/v5/campaigns/campaign_n/ops', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `vf_session=${cookies.admin}` }, body: JSON.stringify({ ops }) });
    if (r.ok) sent += ops.length; else { log('ops failed', r.status, (await r.text()).slice(0, 100)); break; }
  }
  log('marked', sent, 'of', keys.length, 'houses');
}
await page.close();

// ── interaction ──
page = await open('SECOND START');
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
async function drag(from, to, steps = 14) {
  await touch('touchStart', [from]);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]); await sleep(16); }
  await touch('touchEnd', []);
}
async function pinch(cx, cy, from, to, steps = 12) {
  await touch('touchStart', [[cx - from, cy]]); await touch('touchStart', [[cx - from, cy], [cx + from, cy]]);
  for (let i = 1; i <= steps; i++) { const d = from + ((to - from) * i) / steps; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await sleep(16); }
  await touch('touchEnd', []);
}
if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
const reset = () => page.evaluate(() => { window.__long.length = 0; window.__frames = []; let last = performance.now(); const tick = (t) => { window.__frames.push(t - last); last = t; window.__raf = requestAnimationFrame(tick); }; cancelAnimationFrame(window.__raf); window.__raf = requestAnimationFrame(tick); });
const report = async (label) => {
  const r = await page.evaluate(() => { const f = window.__frames.slice(1).sort((a, c) => a - c); const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))] ?? 0; return { frames: f.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), worst: Math.round(f[f.length - 1] ?? 0), over100: f.filter((x) => x > 100).length, long: window.__long.length, longMs: window.__long.reduce((s, [, d]) => s + d, 0), longMax: Math.max(0, ...window.__long.map(([, d]) => d)), tiles: null }; });
  log(`${label.padEnd(34)} frames ${r.frames} · frame p50 ${r.p50} p95 ${r.p95} worst ${r.worst} ms · >100 ms: ${r.over100} · long tasks ${r.long} (${r.longMs} ms, max ${r.longMax})`);
};
const jump = async (x, y, z) => { await page.evaluate(([c, zoom]) => window.__v5Map.jumpTo({ center: c, zoom }), [M(x, y), z]); await page.evaluate(() => new Promise((r) => { const m = window.__v5Map; const t = setTimeout(r, 4000); m.once('idle', () => { clearTimeout(t); r(); }); })); };
const mid = BLOCKS * 50;
for (const z of [18, 16.5, 15, 13.5]) {
  await jump(mid, mid, z); await sleep(500); await reset();
  for (let i = 0; i < 6; i++) { await drag([300, 600], [100, 250]); await drag([100, 250], [320, 580]); }
  await sleep(600);
  await report(`pan at z${z}`);
}
await jump(mid, mid, 17); await sleep(500); await reset();
for (let i = 0; i < 4; i++) { await pinch(205, 400, 40, 140); await sleep(300); await pinch(205, 400, 140, 40); await sleep(300); }
await report('pinch zoom in/out (z17 start)');
if (process.env.PROFILE) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), cat = new Map();
  const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id); const fn = n.callFrame.functionName || '(anon)'; const url = n.callFrame.url.split('/').pop().split('?')[0];
    const key = `${fn} ${url}:${n.callFrame.lineNumber}`; const ms = dt[i] ?? 0;
    self.set(key, (self.get(key) ?? 0) + ms);
    const c = fn === '(idle)' ? 'idle' : fn === '(garbage collector)' ? 'gc' : fn === '(program)' ? 'program' : /mapRuntime/.test(url) ? 'maplibre' : /^v5-/.test(url) ? 'app (v5)' : url ? url : 'native / anonymous';
    cat.set(c, (cat.get(c) ?? 0) + ms);
  });
  const busy = [...self.entries()].filter(([k]) => !k.startsWith('(idle)')).reduce((a, [, v]) => a + v, 0);
  log('--- main thread, by where the time goes (busy time only) ---');
  for (const [k, v] of [...cat.entries()].filter(([k]) => k !== 'idle').sort((a, c) => c[1] - a[1])) log(`${(v / 1000).toFixed(0).padStart(7)} ms ${((v / busy) * 100).toFixed(1).padStart(5)} %  ${k}`);
  log('--- the functions with the most self time ---');
  for (const [k, v] of [...self.entries()].filter(([k]) => !k.startsWith('(idle)')).sort((a, c) => c[1] - a[1]).slice(0, 30)) log(`${(v / 1000).toFixed(0).padStart(7)} ms ${((v / busy) * 100).toFixed(1).padStart(5)} %  ${k}`);
}
await b.close();
server.kill();

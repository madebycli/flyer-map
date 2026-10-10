// Soak test: the same user actions over and over (pan/zoom across the city, lock/unlock the phone, WebGL context loss,
// open/close sheets, mark/undo). After warm-up nothing may keep growing: JS heap, DOM nodes, listeners, engine memory, map tiles.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
import fs from 'node:fs';
const cookies = JSON.parse(fs.readFileSync(new URL('./cookies.json', import.meta.url), 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--no-proxy-server', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const CYCLES = Number(process.env.SOAK_CYCLES ?? 40), WARM = 8;
const M = (x, y) => [13 + x / 70053, 51 + y / 110574];
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } });
await ctx.addCookies([{ name: 'vf_session', value: cookies.admin, url: 'http://localhost:8140' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:8140/v5.html?campaign=campaign_n&debug');
await page.getByText('Kartendaten fehlen').waitFor({ timeout: 4000 }).then(() => page.getByRole('button', { name: 'Kartendaten laden' }).click(), () => {});
await page.waitForSelector('.v5-pill', { timeout: 120000 });
await page.waitForFunction(() => window.__v5Diag, null, { timeout: 60000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');

const sample = async () => {
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const diag = await page.evaluate(() => window.__v5Diag());
  return { heapMB: m.JSHeapUsedSize / 1e6, nodes: m.Nodes, listeners: m.JSEventListeners, wasmMB: diag.engine.wasmBytes / 1e6, tiles: Object.values(diag.tiles?.tiles ?? {}).reduce((a, n) => a + n, 0), vectorTiles: diag.tiles?.tiles?.['v5-tiles'] ?? 0, layers: diag.tiles?.layers, sources: diag.tiles?.sources, providers: diag.tiles?.providers };
};
const idle = () => page.evaluate(() => new Promise((r) => { const m = window.__v5Map; const t = setTimeout(r, 1500); m.once('idle', () => { clearTimeout(t); r(); }); }));
const jump = (x, y, z) => page.evaluate(([c, zoom]) => window.__v5Map.jumpTo({ center: c, zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } }), [M(x, y), z]);
const click = async (x, y) => { const p = await page.evaluate((c) => { const q = window.__v5Map.project(c); return [q.x, q.y]; }, M(x, y)); await page.mouse.click(p[0], p[1]); };
const lockUnlock = () => page.evaluate(async () => {
  const set = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
  set('hidden'); await new Promise((r) => setTimeout(r, 150)); set('visible');
});
const loseContext = () => page.evaluate(async () => {
  const gl = window.__v5Map.getCanvas().getContext('webgl2') ?? window.__v5Map.getCanvas().getContext('webgl');
  const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) return false;
  ext.loseContext(); await new Promise((r) => setTimeout(r, 200)); ext.restoreContext(); await new Promise((r) => setTimeout(r, 400)); return true;
});

const spots = [[150, 150, 16.6], [900, 300, 17.8], [400, 1000, 15.4], [1100, 1100, 14], [200, 200, 18.2], [600, 600, 12.5]];
const cycle = async (i) => {
  const [x, y, z] = spots[i % spots.length];
  await jump(x, y, z); await idle();
  await lockUnlock();
  if (i % 5 === 0 && !process.env.SOAK_NOLOSE) await loseContext();
  await jump(x + 40, y + 25, Math.max(15.8, z)); await idle();
  await click(x + 40, y + 25);
  await page.waitForTimeout(120);
  if (await page.locator('.v5-sheet').count()) {
    const mark = page.getByRole('button', { name: 'Ausgeteilt' }).first();
    if (await mark.count()) { await mark.click(); await page.waitForTimeout(80); const undo = page.getByRole('button', { name: 'Rückgängig' }); if (await undo.count()) await undo.click(); }
    await page.getByRole('button', { name: 'Schließen' }).first().click().catch(() => {});
  }
};
const samples = [];
for (let i = 0; i < CYCLES; i++) {
  await cycle(i);
  if (i === WARM - 1 || i === CYCLES - 1 || (i + 1) % 8 === 0) { const s = await sample(); samples.push([i + 1, s]); console.log(`cycle ${i + 1}: ${JSON.stringify(s)}`); }
}
const base = samples.find(([i]) => i === WARM)?.[1] ?? samples[0][1], last = samples.at(-1)[1];
check(`JS heap grows < 12 MB over ${CYCLES - WARM} cycles`, last.heapMB - base.heapMB < 12, `${base.heapMB.toFixed(1)} → ${last.heapMB.toFixed(1)} MB`);
check('DOM nodes stay flat (±200)', Math.abs(last.nodes - base.nodes) < 200, `${base.nodes} → ${last.nodes}`);
check('event listeners stay flat (±40)', Math.abs(last.listeners - base.listeners) < 40, `${base.listeners} → ${last.listeners}`);
check('engine (wasm) memory does not grow while only panning', last.wasmMB - base.wasmMB < 2, `${base.wasmMB.toFixed(1)} → ${last.wasmMB.toFixed(1)} MB`);
check('layers/sources/providers never multiply', last.layers === base.layers && last.sources === base.sources && last.providers === base.providers, JSON.stringify([base.layers, base.sources, base.providers, '→', last.layers, last.sources, last.providers]));
// A tile count that reads 0 because the adapter does not know this MapLibre version would turn the check below green without measuring anything.
check('the tile count is really measured (the vector source holds tiles at every sample)', samples.every(([, s]) => s.tiles > 0 && s.vectorTiles > 0), JSON.stringify(samples.map(([i, s]) => [i, s.tiles, s.vectorTiles])));
check('cached tiles stay bounded', last.tiles < Math.max(120, base.tiles * 2), `${base.tiles} → ${last.tiles}`);
await b.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);

// The thin bridge between the Rust app (flyermap-web, wasm-bindgen externs in src/map/bridge.rs) and MapLibre GL JS, which is used as it is.
// Rules: no app logic here. Styles, layers, expressions and decisions come from Rust as JSON; this file calls MapLibre and hands back plain
// numbers and JSON. MapLibre is loaded on first use from vendor/ next to index.html (its worker file sits beside it).
let ml = null;
const providers = new Map();
const stats = { tiles: 0, empty: 0, failed: 0, bytes: 0, noProvider: 0 };

export async function load() {
  if (!ml) {
    ml = await import(new URL('vendor/maplibre-gl.mjs', document.baseURI).href);
    // Tiles come from the engine (Rust, in its own worker) through one protocol; each map owns a token.
    ml.addProtocol('v5t', async (params) => {
      const m = /^v5t:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
      const provider = m ? providers.get(m[1]) : undefined;
      if (!provider) { stats.noProvider++; return { data: new ArrayBuffer(0) }; }
      try {
        const bytes = await provider(Number(m[2]), Number(m[3]), Number(m[4]));
        stats.tiles++; stats.bytes += bytes.byteLength; if (!bytes.byteLength) stats.empty++;
        return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      } catch (error) { stats.failed++; throw error; }
    });
  }
  return ml.getVersion ? ml.getVersion() : '';
}

const styleOf = (style) => (style.startsWith('{') ? JSON.parse(style) : new URL(style, document.baseURI).href);
const remember = (map, style) => { map.__vfStyle = style.startsWith('{') ? null : styleOf(style); };

export function create(container, style, lng, lat, zoom, pixelRatio) {
  const map = new ml.Map({
    container, style: styleOf(style), center: [lng, lat], zoom, attributionControl: false, fadeDuration: 0, pitchWithRotate: false,
    pixelRatio, clickTolerance: 8, maxPitch: 0, dragRotate: true,
  });
  // tap-then-drag zooms in MapLibre; marking is made of taps and drags, so that gesture is off (pinch and rotate stay)
  map.touchZoomRotate?._tapDragZoom?.disable?.();
  // a basemap may ask for icons its sprite lacks: answer once with an empty image instead of a warning per tile
  map.on('styleimagemissing', (event) => { if (!map.hasImage(event.id)) map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
  remember(map, style);
  // for the browser flows and the diagnostics: the map itself and its counters, only when the address says `debug`
  if (location.search.includes('debug')) { window.__rsMap = map; window.__rsDebug = () => JSON.parse(debugCounts(map)); }
  return map;
}

/** `style.load`, `idle`, `moveend`, `movestart`, `rotate`: cb(); `click`: cb(x, y); `error`: cb(kind, status, isStyle). */
export function on(map, name, cb) {
  if (name === 'click') map.on('click', (e) => cb(e.point.x, e.point.y));
  // the third argument says whether the style itself failed (the app then falls back to a plain background); no address leaves this file
  else if (name === 'error') map.on('error', (e) => cb(e.sourceId ? 'source' : e.error?.url ? 'resource' : 'other', e.error?.status ?? 0, !!e.error?.url && e.error.url === map.__vfStyle));
  else map.on(name, () => cb());
}

export function setStyle(map, style) { remember(map, style); map.setStyle(styleOf(style)); }
export function isStyleLoaded(map) { return !!map.isStyleLoaded(); }
export function hasSource(map, id) { return !!map.getSource(id); }
export function hasLayer(map, id) { return !!map.getLayer(id); }
export function addSource(map, id, json) { if (!map.getSource(id)) map.addSource(id, JSON.parse(json)); }
export function addLayer(map, json) { const layer = JSON.parse(json); if (!map.getLayer(layer.id)) map.addLayer(layer); }
export function setFilter(map, id, json) { if (map.getLayer(id)) map.setFilter(id, json ? JSON.parse(json) : null); }
export function setData(map, id, json) { map.getSource(id)?.setData(JSON.parse(json)); }
export function setTiles(map, id, url) { map.getSource(id)?.setTiles([url]); }
export function setTileProvider(token, provider) { providers.set(token, provider); }
export function dropTileProvider(token) { providers.delete(token); }

/** Hide the basemap's one-way arrows (noise on a walking map). */
export function hideSymbols(map, pattern) {
  const re = new RegExp(pattern, 'i');
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith('v5-') || layer.type !== 'symbol') continue;
    if (re.test(`${layer.id} ${layer['source-layer'] ?? ''}`)) map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
}

/** Feature-state for many keys at once: `keys` joined by "\n"; houses are painted on outlines and dots, streets on the line. */
export function setState(map, source, keys, name, value) {
  if (!map.getSource(source)) return 0;
  let n = 0;
  for (const key of keys.split('\n')) {
    if (!key) continue;
    const layers = key.startsWith('h:') ? ['houses', 'centers'] : ['segments'];
    for (const sourceLayer of layers) map.setFeatureState({ source, sourceLayer, id: key }, { [name]: value });
    n++;
  }
  return n;
}
export function clearStates(map, source) {
  if (map.getSource(source)) for (const sourceLayer of ['houses', 'centers', 'segments']) map.removeFeatureState({ source, sourceLayer });
}

/** Features drawn in the box (screen px) on the given layers, with their geometry projected to screen px: [{id, t, g}] as JSON. */
export function query(map, x0, y0, x1, y1, layers) {
  const wanted = layers.split(',').filter((id) => map.getLayer(id));
  if (!wanted.length) return '[]';
  const px = (c) => { const p = map.project(c); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; };
  const out = [];
  for (const f of map.queryRenderedFeatures([[x0, y0], [x1, y1]], { layers: wanted })) {
    const g = f.geometry;
    let t = 'p', parts;
    if (g.type === 'Point') parts = [[px(g.coordinates)]];
    else if (g.type === 'MultiPoint') parts = g.coordinates.map((c) => [px(c)]);
    else if (g.type === 'LineString') { t = 'l'; parts = [g.coordinates.map(px)]; }
    else if (g.type === 'MultiLineString') { t = 'l'; parts = g.coordinates.map((l) => l.map(px)); }
    else if (g.type === 'Polygon') { t = 'a'; parts = [g.coordinates[0].map(px)]; }
    else if (g.type === 'MultiPolygon') { t = 'a'; parts = g.coordinates.map((poly) => poly[0].map(px)); }
    else continue;
    out.push({ id: String(f.id ?? f.properties?.key ?? ''), layer: f.layer.id, t, g: parts });
  }
  return JSON.stringify(out);
}

export function unproject(map, x, y) { const l = map.unproject([x, y]); return new Float64Array([l.lng, l.lat]); }
export function view(map) { const c = map.getCenter(); const b = map.getBounds(); return new Float64Array([c.lng, c.lat, map.getZoom(), map.getBearing(), b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); }
export function dragPan(map, on) { if (on) map.dragPan.enable(); else map.dragPan.disable(); }
export function doubleClickZoom(map, on) { if (on) map.doubleClickZoom.enable(); else map.doubleClickZoom.disable(); }
export function zoomBy(map, delta) { map.zoomTo(map.getZoom() + delta, { duration: 180 }); }
export function resetNorth(map) { map.resetNorth({ duration: 250 }); }
export function easeTo(map, lng, lat, zoom) { map.easeTo({ center: [lng, lat], zoom, duration: 450 }); }
export function fitBounds(map, w, s, e, n, padding) { map.fitBounds([[w, s], [e, n]], { padding, duration: 0, maxZoom: 17.2 }); }
export function jumpTo(map, lng, lat, zoom) { map.jumpTo({ center: [lng, lat], zoom }); }
export function container(map) { return map.getCanvasContainer(); }
export function canvasSize(map) { const c = map.getCanvas(); return new Float64Array([c.clientWidth, c.clientHeight]); }

/** For the diagnostics and the flows: tiles held per source, layers, and the tile protocol's counters. */
export function debugCounts(map) {
  const style = map.style ?? {};
  const caches = style.tileManagers ?? style.sourceCaches ?? {};
  const tiles = Object.fromEntries(Object.entries(caches).map(([id, cache]) => [id, cache.getIds ? cache.getIds().length : Object.keys(cache._tiles ?? {}).length]));
  return JSON.stringify({ tiles, layers: map.getStyle()?.layers?.length ?? 0, protocol: { ...stats } });
}
export function remove(map) { map.remove(); }

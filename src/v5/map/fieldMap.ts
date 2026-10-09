import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap, type StyleSpecification, type VectorTileSource } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { MapData } from '../engine/host.ts';
import type { LngLat } from '../engine/types.ts';
import type { FieldStore } from '../store/store.ts';
import type { EntityKey, Status } from '../store/types.ts';

export const SEGMENT_SOURCE = 'v5-segments';
export const HOUSE_SOURCE = 'v5-houses';
export const CENTER_SOURCE = 'v5-centers';
export const TILE_SOURCE = 'v5-tiles';
export const AREA_SOURCE = 'v5-areas';
export const DRAW_SOURCE = 'v5-draw';
export const NOTE_SOURCE = 'v5-notes';
export const PICKUP_SOURCE = 'v5-pickups';
export const ME_SOURCE = 'v5-me';

export type Theme = 'dark' | 'light';

/**
 * Calm, desaturated and still telling four states apart: "open" is a quiet slate (the work still to do should not shout),
 * done is a soft green, later a muted amber, not-deliverable a dusty rose. The light theme uses deeper variants for contrast.
 */
const STATUS_PALETTE: Record<Theme, Record<Status, string>> = {
  dark: { open: '#8aa0b4', completed: '#5fc79f', later: '#d6b062', 'not-deliverable': '#c9808c' },
  light: { open: '#6c7f92', completed: '#2c9873', later: '#b4872b', 'not-deliverable': '#b05b6b' },
};
export const statusColors = (theme: Theme): Record<Status, string> => STATUS_PALETTE[theme];
export const STATUS_COLORS = STATUS_PALETTE.dark;

/** Status-dependent opacity: untouched streets and houses stay translucent, so the basemap shows through and progress stands out. */
const OPEN_ALPHA = { line: 0.5, fill: 0.5, dot: 0.6 };
const DONE_ALPHA = { line: 0.92, fill: 0.85, dot: 0.9 };
const byStatus = (open: number | ExpressionSpecification, done: number | ExpressionSpecification): ExpressionSpecification =>
  ['match', ['coalesce', ['feature-state', 'status'], 'open'], 'open', open, done];

/** Basemap styles are deployment configuration (served in the Aktion's meta), never a URL baked into the client. */
export type Basemap = { dark: string; light: string } | null;
const BLANK_BACKGROUND: Record<Theme, string> = { dark: '#0e1513', light: '#eef1ef' };
export const blankStyle = (theme: Theme): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': BLANK_BACKGROUND[theme] } }] });
const CASING: Record<Theme, string> = { dark: 'rgba(7,11,10,0.92)', light: 'rgba(255,255,255,0.92)' };
const OUTLINE: Record<Theme, string> = { dark: 'rgba(7,11,10,0.55)', light: 'rgba(32,33,36,0.45)' };
const PREVIEW: Record<Theme, string> = { dark: '#8fb8ff', light: '#2a62c9' };
const SELECTED_OUTLINE: Record<Theme, string> = { dark: '#ffffff', light: '#202124' };

const statusMatch = (theme: Theme): ExpressionSpecification => {
  const c = STATUS_PALETTE[theme];
  return ['match', ['coalesce', ['feature-state', 'status'], 'open'], 'completed', c.completed, 'later', c.later, 'not-deliverable', c['not-deliverable'], c.open];
};

export type Hit = { kind: 'segment' | 'house' | 'note' | 'pickup'; id: string };
export type Pt = { x: number; y: number };
/** A pointer gesture owned by the active tool. `down` decides whether the tool takes it (map pan is suspended then). */
export type Gesture = {
  down(point: Pt, lngLat: LngLat): boolean;
  move?(point: Pt, lngLat: LngLat): void;
  up?(point: Pt, lngLat: LngLat, moved: boolean): void;
  cancel?(): void;
};
export type AreaShape = { id: string; name: string; color: string; ring: LngLat[] };
export type FieldMapOptions = {
  container: HTMLElement;
  /** Basemap styles per theme (tests, or the server's choice); without any, the plain background is used. */
  styles?: Partial<Record<Theme, string | StyleSpecification>>;
  /** Called when the map is rotated away from north (and back), so the compass control can appear. */
  onRotate?: (bearing: number) => void;
  theme?: Theme;
  center?: [number, number];
  zoom?: number;
  onHit?: (hit: Hit | null, point: Pt) => void;
  /** Route marking only cares about street segments; houses must not swallow those taps. */
  segmentsOnly?: () => boolean;
  /** Note markers take taps only while this returns true (inspect tool); otherwise they must not swallow marking taps. */
  noteHits?: () => boolean;
};

export type TileFn = (z: number, x: number, y: number) => Promise<ArrayBuffer>;
type DataMode = 'tiles' | 'geojson';
type Layer = 'segments' | 'houses' | 'centers';

/** Tiles come from the engine (Rust) through one global protocol; each map instance owns a token. */
const providers = new Map<string, TileFn>();
let protocolRegistered = false;
let tokens = 0;
function ensureTileProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  maplibregl.addProtocol('v5t', async (params) => {
    const m = /^v5t:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    const provider = m ? providers.get(m[1]) : undefined;
    if (!m || !provider) return { data: new ArrayBuffer(0) };
    return { data: await provider(Number(m[2]), Number(m[3]), Number(m[4])) };
  });
}

/**
 * The map owns geometry (loaded once per network) and nothing else. Status lives in
 * feature-state, so a status change costs one setFeatureState call and never
 * re-serialises or re-tiles geometry. Switching the theme swaps the basemap and then
 * re-installs our layers, geometry and status from what this class remembers.
 */
export class FieldMap {
  readonly map: MlMap;
  private theme: Theme;
  private selected: EntityKey[] = [];
  private mode: DataMode = 'tiles';
  private geo: MapData | null = null;
  private readonly token = `m${++tokens}`;
  private tileVersion = 0;
  private store: FieldStore | null = null;
  private unbind: (() => void) | null = null;
  private previewed = new Set<EntityKey>();
  private areas: AreaShape[] = [];
  private draw: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private gesture: Gesture | null = null;
  private gestureActive = false;
  /** The click that follows a gesture the active tool already handled must not be handled a second time. */
  private swallowClick = false;
  private pointers = new Set<number>();
  private applied = 0;
  private styleFallback = false;
  /** The style URL we are currently waiting for; a failed theme switch must also fall back (the old style is still 'loaded'). */
  private expectedStyle: string | StyleSpecification;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(private readonly options: FieldMapOptions) {
    this.theme = options.theme ?? 'dark';
    this.styles = { ...options.styles };
    this.expectedStyle = this.styleFor(this.theme);
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.map = new maplibregl.Map({
      container: options.container, style: this.styleFor(this.theme), center: options.center ?? [13.0, 51.0],
      zoom: options.zoom ?? 15, attributionControl: false, fadeDuration: 0, pitchWithRotate: false,
      maxPitch: 0, dragRotate: true,
    });
    // Test/diagnostic handle, only with ?debug in the URL.
    if (typeof location !== 'undefined' && location.search.includes('debug')) (window as unknown as { __v5Map?: MlMap }).__v5Map = this.map;
    // Own controls live in the app shell; the map only keeps the (licence-required) attribution.
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    this.map.on('style.load', () => this.install());
    let rotated = false;
    this.map.on('rotate', () => {
      const now = Math.abs(this.map.getBearing()) > 0.5;
      if (now !== rotated) { rotated = now; options.onRotate?.(this.map.getBearing()); }
    });
    // Self-heal: a style swap that was superseded or fell back can finish without a usable `style.load`; whenever the
    // map is idle on a loaded style that lacks our sources, install them again.
    this.map.on('idle', () => { if (this.map.isStyleLoaded() && !this.map.getSource(this.firstSource())) this.install(); });
    // Field work must survive a basemap outage: if the style itself cannot be fetched, fall back to a plain background.
    this.map.on('error', (event) => {
      const failedUrl = (event as { error?: { url?: string } }).error?.url;
      if (this.styleFallback || !failedUrl || failedUrl !== this.expectedStyle) return;
      this.styleFallback = true;
      this.map.setStyle(blankStyle(this.theme));
    });
    this.map.on('click', (event) => {
      if (this.swallowClick) { this.swallowClick = false; return; }
      if (options.noteHits?.() && this.map.getLayer('v5-pickups-pin')) {
        const pin = this.map.queryRenderedFeatures([[event.point.x - 18, event.point.y - 18], [event.point.x + 18, event.point.y + 18]], { layers: ['v5-pickups-pin'] })[0];
        if (pin) return options.onHit?.({ kind: 'pickup', id: String(pin.properties?.id) }, event.point);
      }
      if (options.noteHits?.() && this.map.getLayer('v5-notes-dot')) {
        const pin = this.map.queryRenderedFeatures([[event.point.x - 16, event.point.y - 16], [event.point.x + 16, event.point.y + 16]], { layers: ['v5-notes-dot'] })[0];
        if (pin) return options.onHit?.({ kind: 'note', id: String(pin.properties?.key) }, event.point);
      }
      // A house is hit only when the tap lies inside it; streets get a forgiving 12 px halo.
      if (!options.segmentsOnly?.()) {
        const houses = this.map.queryRenderedFeatures(event.point, { layers: ['v5-houses-fill'] });
        if (houses.length) return options.onHit?.({ kind: 'house', id: String(houses[0].id).slice(2) }, event.point);
      }
      const box: [[number, number], [number, number]] = [[event.point.x - 12, event.point.y - 12], [event.point.x + 12, event.point.y + 12]];
      const segments = this.map.queryRenderedFeatures(box, { layers: ['v5-segments-line'] });
      options.onHit?.(segments.length ? { kind: 'segment', id: String(segments[0].id).slice(2) } : null, event.point);
    });
    this.wireGestures();
  }

  private styles: Partial<Record<Theme, string | StyleSpecification>>;
  private baseVisible = true;
  private styleFor(theme: Theme): string | StyleSpecification {
    return this.baseVisible ? this.styles[theme] ?? blankStyle(theme) : blankStyle(theme);
  }

  /** Use the deployment's basemap (null = plain background). Swapping re-installs our layers on `style.load`. */
  setBasemap(basemap: Basemap) {
    const next = basemap ? { dark: basemap.dark, light: basemap.light } : {};
    if (this.styles.dark === next.dark && this.styles.light === (next as Partial<Record<Theme, string>>).light) return;
    this.styles = next;
    this.restyle();
  }

  /** "Karte aus": the plain background only, which also saves data and battery. */
  setBasemapVisible(visible: boolean) {
    if (visible === this.baseVisible) return;
    this.baseVisible = visible;
    this.restyle();
  }

  private restyle() {
    this.styleFallback = false;
    this.expectedStyle = this.styleFor(this.theme);
    this.map.setStyle(this.expectedStyle);
  }

  /** Runs after every style load (first load and theme switches): layers, then geometry, then status. */
  private install() {
    const map = this.map;
    if (map.getSource(this.firstSource())) return;
    this.installLayers();
    this.pushData();
    this.pushAreas();
    this.pushDraw();
    this.pushNotes();
    this.pushPickups();
    if (this.store) void this.applyChunked([...this.store.entries()].map(([key, entry]) => [key, entry.status] as [EntityKey, Status]));
    this.previewed = new Set(); // feature-state died with the old sources
    this.selected = [];
    this.resolveReady();
  }

  private installLayers() {
    const map = this.map, theme = this.theme;
    ensureTileProtocol();
    const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (this.mode === 'tiles') {
      map.addSource(TILE_SOURCE, { type: 'vector', tiles: [this.tileUrl()], minzoom: 11, maxzoom: 17, promoteId: { segments: 'key', houses: 'key', centers: 'key' } });
    } else {
      map.addSource(SEGMENT_SOURCE, { type: 'geojson', data: empty, promoteId: 'key', tolerance: 0.2 });
      map.addSource(HOUSE_SOURCE, { type: 'geojson', data: empty, promoteId: 'key', tolerance: 0.1 });
      map.addSource(CENTER_SOURCE, { type: 'geojson', data: empty, promoteId: 'key' });
    }
    const src = (layer: Layer): { source: string; 'source-layer'?: string } => this.mode === 'tiles' ? { source: TILE_SOURCE, 'source-layer': layer } : { source: layer === 'segments' ? SEGMENT_SOURCE : layer === 'houses' ? HOUSE_SOURCE : CENTER_SOURCE };
    const selectedOn: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    map.addSource(AREA_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource(DRAW_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'v5-areas-fill', type: 'fill', source: AREA_SOURCE, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'active'], 1], 0.12, 0.04] } });
    map.addLayer({
      id: 'v5-areas-line', type: 'line', source: AREA_SOURCE, layout: { 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-opacity': 0.8, 'line-width': ['case', ['==', ['get', 'active'], 1], 2.6, 1.6], 'line-dasharray': [2.4, 1.8] },
    });
    // Zoomed out, houses become status-coloured dots: the whole city reads as progress, not as a block of lines.
    map.addLayer({
      id: 'v5-houses-dots', type: 'circle', ...src('centers'), minzoom: 11.5, maxzoom: 15.2,
      paint: {
        'circle-color': statusMatch(theme), 'circle-opacity': byStatus(OPEN_ALPHA.dot, DONE_ALPHA.dot), 'circle-stroke-width': 0,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 0.7, 14, 1.6, 15.2, 3.2],
      },
    });
    map.addLayer({
      id: 'v5-houses-fill', type: 'fill', ...src('houses'), minzoom: 15.2,
      paint: { 'fill-color': statusMatch(theme), 'fill-opacity': ['case', selectedOn, 1, byStatus(OPEN_ALPHA.fill, DONE_ALPHA.fill)] },
    });
    map.addLayer({
      id: 'v5-houses-outline', type: 'line', ...src('houses'), minzoom: 16.5, layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': ['case', selectedOn, SELECTED_OUTLINE[theme], OUTLINE[theme]], 'line-width': ['case', selectedOn, 2.5, 0.5] },
    });
    map.addLayer({
      id: 'v5-segments-casing', type: 'line', ...src('segments'), minzoom: 13.5, ...this.segmentFilterSpec(),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CASING[theme],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13.5, 1.6, 16, 6.5, 20, 18],
      },
    });
    map.addLayer({
      id: 'v5-segments-preview', type: 'line', ...src('segments'), ...this.segmentFilterSpec(),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': PREVIEW[theme], 'line-opacity': ['case', ['boolean', ['feature-state', 'preview'], false], 0.7, 0],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 5, 16, 13, 20, 32],
      },
    });
    // Thin and translucent when zoomed far out, so a whole city reads as texture, not as one solid block.
    map.addLayer({
      id: 'v5-segments-line', type: 'line', ...src('segments'), ...this.segmentFilterSpec(),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': statusMatch(theme),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, byStatus(0.3, 0.55), 14, byStatus(OPEN_ALPHA.line, DONE_ALPHA.line)],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
          10, ['case', selectedOn, 3, 0.4], 13, ['case', selectedOn, 4, 0.9], 16, ['case', selectedOn, 9, 3.6], 20, ['case', selectedOn, 24, 11]],
      },
    });
    map.addLayer({
      id: 'v5-houses-preview', type: 'line', ...src('houses'), minzoom: 15.2,
      paint: { 'line-color': PREVIEW[theme], 'line-width': 2.5, 'line-opacity': ['case', ['boolean', ['feature-state', 'preview'], false], 1, 0] },
    });
    // Tool overlay: lasso, area edit polygon, vertex and midpoint handles (always on top).
    map.addLayer({ id: 'v5-draw-fill', type: 'fill', source: DRAW_SOURCE, filter: ['==', ['get', 'kind'], 'fill'], paint: { 'fill-color': ['coalesce', ['get', 'color'], '#7aa8ff'], 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'v5-draw-line', type: 'line', source: DRAW_SOURCE, filter: ['==', ['get', 'kind'], 'line'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#7aa8ff'], 'line-width': 3 } });
    map.addLayer({
      id: 'v5-draw-mid', type: 'circle', source: DRAW_SOURCE, filter: ['==', ['get', 'kind'], 'mid'],
      paint: { 'circle-radius': 7, 'circle-color': theme === 'dark' ? '#0e1513' : '#ffffff', 'circle-stroke-color': ['coalesce', ['get', 'color'], '#7aa8ff'], 'circle-stroke-width': 2, 'circle-opacity': 0.9 },
    });
    map.addLayer({
      id: 'v5-draw-vertex', type: 'circle', source: DRAW_SOURCE, filter: ['==', ['get', 'kind'], 'vertex'],
      paint: { 'circle-radius': ['case', ['==', ['get', 'selected'], 1], 13, 10], 'circle-color': ['case', ['==', ['get', 'selected'], 1], '#ffd24a', '#ffffff'], 'circle-stroke-color': ['coalesce', ['get', 'color'], '#7aa8ff'], 'circle-stroke-width': 3 },
    });
    // Note markers: a coloured pin per annotated street/house/Area, on top of everything but the tool overlay.
    map.addSource(NOTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'v5-notes-halo', type: 'circle', source: NOTE_SOURCE,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 16, 13], 'circle-color': theme === 'dark' ? '#0e1513' : '#ffffff', 'circle-opacity': 0.92 },
    }, 'v5-draw-fill');
    map.addLayer({
      id: 'v5-notes-dot', type: 'circle', source: NOTE_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 9.5],
        'circle-color': ['coalesce', ['get', 'color'], '#b0bec5'],
        'circle-stroke-width': ['case', ['>', ['get', 'count'], 1], 3, 0], 'circle-stroke-color': theme === 'dark' ? '#0e1513' : '#ffffff',
      },
    }, 'v5-draw-fill');
    // Sonder-Marker (pickup tasks): a diamond, so they never read as a house, a street or a note.
    if (!map.hasImage('v5-pin') && typeof document !== 'undefined') {
      const size = 64, canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const g = canvas.getContext('2d');
      if (g) {
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(size / 2, 4); g.lineTo(size - 6, size / 2); g.lineTo(size / 2, size - 4); g.lineTo(6, size / 2); g.closePath(); g.fill();
        map.addImage('v5-pin', g.getImageData(0, 0, size, size), { sdf: true });
      }
    }
    map.addSource(PICKUP_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (map.hasImage('v5-pin')) {
      map.addLayer({
        id: 'v5-pickups-halo', type: 'symbol', source: PICKUP_SOURCE,
        layout: { 'icon-image': 'v5-pin', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.42, 16, 0.78] },
        paint: { 'icon-color': theme === 'dark' ? '#0e1513' : '#ffffff' },
      }, 'v5-draw-fill');
      map.addLayer({
        id: 'v5-pickups-pin', type: 'symbol', source: PICKUP_SOURCE,
        layout: { 'icon-image': 'v5-pin', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 0.58] },
        paint: { 'icon-color': ['coalesce', ['get', 'color'], '#c77dff'] },
      }, 'v5-draw-fill');
    }
    // Own position: a soft halo and a dot, refreshed only when the person asks ("Standort aktualisieren").
    map.addSource(ME_SOURCE, { type: 'geojson', data: this.meFeatures() });
    map.addLayer({ id: 'v5-me-halo', type: 'circle', source: ME_SOURCE, paint: { 'circle-radius': 16, 'circle-color': PREVIEW[theme], 'circle-opacity': 0.22 } });
    map.addLayer({ id: 'v5-me-dot', type: 'circle', source: ME_SOURCE, paint: { 'circle-radius': 6, 'circle-color': PREVIEW[theme], 'circle-stroke-width': 2.5, 'circle-stroke-color': theme === 'dark' ? '#0e1513' : '#ffffff' } });
    // House numbers need a glyph endpoint; a style without one (tests, offline stub) simply has no labels.
    if (map.getStyle().glyphs) map.addLayer({
      id: 'v5-houses-number', type: 'symbol', ...src('houses'), minzoom: 17.5,
      layout: { 'text-field': ['get', 'num'], 'text-size': 11, 'text-allow-overlap': false, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': theme === 'dark' ? '#0b0f0e' : '#202124', 'text-halo-color': theme === 'dark' ? 'rgba(255,255,255,0.85)' : '#ffffff', 'text-halo-width': 1.2 },
    });
  }

  /** "Nur Straßen mit Häusern": the tile property `h` says whether the street piece has any house along it. */
  private segmentFilter(): ExpressionSpecification | undefined { return this.housesOnly ? ['==', ['get', 'h'], '1'] : undefined; }
  private segmentFilterSpec(): { filter?: ExpressionSpecification } { const filter = this.segmentFilter(); return filter ? { filter } : {}; }
  private housesOnly = false;
  setHousesOnly(on: boolean) {
    if (on === this.housesOnly) return;
    this.housesOnly = on;
    for (const id of ['v5-segments-casing', 'v5-segments-preview', 'v5-segments-line']) if (this.map.getLayer(id)) this.map.setFilter(id, this.segmentFilter() ?? null);
  }

  private me: LngLat | null = null;
  private meFeatures(): FeatureCollection { return { type: 'FeatureCollection', features: this.me ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: this.me } }] : [] }; }

  /** One fresh position fix, then fly there. No watcher is left running (battery, privacy, nothing to leak). */
  locate(): Promise<'ok' | 'denied' | 'unavailable'> {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve('unavailable');
      navigator.geolocation.getCurrentPosition((position) => {
        this.me = [position.coords.longitude, position.coords.latitude];
        (this.map.getSource(ME_SOURCE) as GeoJSONSource | undefined)?.setData(this.meFeatures());
        this.map.easeTo({ center: this.me, zoom: Math.max(this.map.getZoom(), 17), duration: 450 });
        resolve('ok');
      }, (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
    });
  }

  zoomBy(delta: number) { this.map.zoomTo(this.map.getZoom() + delta, { duration: 180 }); }
  resetNorth() { this.map.resetNorth({ duration: 250 }); }

  private firstSource() { return this.mode === 'tiles' ? TILE_SOURCE : SEGMENT_SOURCE; }
  private tileUrl() { return `v5t://${this.token}/{z}/{x}/{y}?v=${this.tileVersion}`; }

  /** After (re)install: hand the geometry to the sources of the current mode. */
  private pushData() {
    if (this.mode === 'tiles') return; // the tile source already points at this map's provider
    if (this.geo?.kind !== 'geojson') return;
    (this.map.getSource(SEGMENT_SOURCE) as GeoJSONSource | undefined)?.setData(this.geo.segments);
    (this.map.getSource(HOUSE_SOURCE) as GeoJSONSource | undefined)?.setData(this.geo.houses);
    (this.map.getSource(CENTER_SOURCE) as GeoJSONSource | undefined)?.setData(this.geo.centers);
  }

  /** Swap the basemap; our layers, geometry and statuses are re-installed on `style.load`. */
  setTheme(theme: Theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.restyle();
  }

  /**
   * Replace geometry (rare: a new Area). Rust engine → vector tiles pulled through `tile`; TypeScript fallback → GeoJSON.
   * Status is re-applied from the store afterwards.
   */
  async loadMapData(data: MapData, tile: TileFn): Promise<void> {
    await this.ready;
    providers.set(this.token, tile);
    this.geo = data;
    const mode: DataMode = data.kind === 'tiles' ? 'tiles' : 'geojson';
    if (mode !== this.mode) {
      this.mode = mode;
      this.removeDataLayers();
      this.installLayers();
      this.pushData();
    } else if (mode === 'tiles') {
      // New tile URL = the source drops its cached tiles and asks the engine again.
      this.tileVersion++;
      (this.map.getSource(TILE_SOURCE) as VectorTileSource | undefined)?.setTiles([this.tileUrl()]);
    } else this.pushData();
    for (const source of [TILE_SOURCE, SEGMENT_SOURCE, HOUSE_SOURCE, CENTER_SOURCE]) if (this.map.getSource(source)) this.map.removeFeatureState({ source });
    this.selected = [];
  }

  /** Every layer and source of ours (data, notes, pickups, tools): used when the data mode switches. */
  private removeDataLayers() {
    const style = this.map.getStyle();
    for (const layer of style.layers ?? []) if (layer.id.startsWith('v5-')) this.map.removeLayer(layer.id);
    for (const id of Object.keys(style.sources ?? {})) if (id.startsWith('v5-')) this.map.removeSource(id);
  }

  /** Feature-state targets of a key: houses are painted on the outlines and on the dots, streets on the line. */
  private targets(key: EntityKey): { source: string; sourceLayer?: string }[] {
    if (this.mode === 'tiles') return key.startsWith('h:') ? [{ source: TILE_SOURCE, sourceLayer: 'houses' }, { source: TILE_SOURCE, sourceLayer: 'centers' }] : [{ source: TILE_SOURCE, sourceLayer: 'segments' }];
    return key.startsWith('h:') ? [{ source: HOUSE_SOURCE }, { source: CENTER_SOURCE }] : [{ source: SEGMENT_SOURCE }];
  }

  private setState(key: EntityKey, state: Record<string, unknown>) {
    for (const t of this.targets(key)) if (this.map.getSource(t.source)) this.map.setFeatureState({ ...t, id: key }, state);
  }

  /** Mirror the store into feature-state: initial restore, then only the changed keys. */
  bind(store: FieldStore): void {
    this.unbind?.();
    this.store = store;
    void this.applyChunked([...store.entries()].map(([key, entry]) => [key, entry.status] as [EntityKey, Status]));
    this.unbind = store.subscribe((changes) => { for (const [key, status] of changes) this.paint(key, status); });
  }

  private paint(key: EntityKey, status: Status) {
    this.setState(key, { status });
    this.applied++;
  }

  private async applyChunked(entries: [EntityKey, Status][]) {
    await this.ready;
    for (let i = 0; i < entries.length; i += 4000) {
      for (const [key, status] of entries.slice(i, i + 4000)) this.paint(key, status);
      if (i + 4000 < entries.length) await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  select(keys: EntityKey | EntityKey[] | null) {
    const set = (k: EntityKey, selected: boolean) => this.setState(k, { selected });
    for (const k of this.selected) set(k, false);
    this.selected = keys === null ? [] : Array.isArray(keys) ? keys : [keys];
    for (const k of this.selected) set(k, true);
  }

  /** Highlight what a tool is about to change (route, paint trail, lasso) without touching status. */
  setPreview(keys: Iterable<EntityKey>) {
    const next = new Set(keys);
    const apply = (key: EntityKey, preview: boolean) => this.setState(key, { preview });
    for (const key of this.previewed) if (!next.has(key)) apply(key, false);
    for (const key of next) if (!this.previewed.has(key)) apply(key, true);
    this.previewed = next;
  }

  // ── areas and tool overlay ─────────────────────────────────────
  setAreas(areas: AreaShape[], activeId: string | null = null) {
    this.areas = areas.map((a) => ({ ...a }));
    this.activeArea = activeId;
    this.pushAreas();
  }
  private activeArea: string | null = null;
  private pushAreas() {
    const source = this.map.getSource(AREA_SOURCE) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: 'FeatureCollection',
      features: this.areas.map((a): Feature => ({ type: 'Feature', id: a.id, properties: { id: a.id, name: a.name, color: a.color, active: a.id === this.activeArea ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [a.ring] } })),
    });
  }
  setNotes(features: FeatureCollection) { this.noteFeatures = features; this.pushNotes(); }
  private noteFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private pushNotes() { (this.map.getSource(NOTE_SOURCE) as GeoJSONSource | undefined)?.setData(this.noteFeatures); }

  setPickups(features: FeatureCollection) { this.pickupFeatures = features; this.pushPickups(); }
  private pickupFeatures: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private pushPickups() { (this.map.getSource(PICKUP_SOURCE) as GeoJSONSource | undefined)?.setData(this.pickupFeatures); }

  setDraw(collection: FeatureCollection) { this.draw = collection; this.pushDraw(); }
  private pushDraw() { (this.map.getSource(DRAW_SOURCE) as GeoJSONSource | undefined)?.setData(this.draw); }

  /** Area under a screen point (areas are drawn below houses, so this is only asked by area tools). */
  hitArea(point: Pt): string | null {
    const features = this.map.getSource(AREA_SOURCE) ? this.map.queryRenderedFeatures([point.x, point.y], { layers: ['v5-areas-fill'] }) : [];
    return features.length ? String(features[0].properties?.id ?? features[0].id) : null;
  }

  /** Handle under a point: vertex first (bigger target), then edge midpoints. */
  hitHandle(point: Pt, radius = 18): { kind: 'vertex' | 'mid'; index: number } | null {
    if (!this.map.getLayer('v5-draw-vertex')) return null;
    const box: [[number, number], [number, number]] = [[point.x - radius, point.y - radius], [point.x + radius, point.y + radius]];
    const vertex = this.map.queryRenderedFeatures(box, { layers: ['v5-draw-vertex'] })[0];
    if (vertex) return { kind: 'vertex', index: Number(vertex.properties?.index) };
    const mid = this.map.queryRenderedFeatures(box, { layers: ['v5-draw-mid'] })[0];
    return mid ? { kind: 'mid', index: Number(mid.properties?.edge) } : null;
  }

  /** What is under the finger: a house exactly, a street within a forgiving halo. */
  hitTest(point: Pt, halo = 14): { house: string | null; segment: string | null } {
    const house = this.map.getLayer('v5-houses-fill') ? this.map.queryRenderedFeatures([point.x, point.y], { layers: ['v5-houses-fill'] })[0] : undefined;
    const box: [[number, number], [number, number]] = [[point.x - halo, point.y - halo], [point.x + halo, point.y + halo]];
    const segment = this.map.getLayer('v5-segments-line') ? this.map.queryRenderedFeatures(box, { layers: ['v5-segments-line'] })[0] : undefined;
    return { house: house ? String(house.id).slice(2) : null, segment: segment ? String(segment.id).slice(2) : null };
  }

  unproject(point: Pt): LngLat { const l = this.map.unproject([point.x, point.y]); return [l.lng, l.lat]; }

  /**
   * One tool at a time owns pointer gestures. While it holds a gesture, one-finger panning is suspended; a second finger
   * cancels the gesture and hands pan/zoom back, so painting never traps the map.
   */
  setGesture(gesture: Gesture | null) {
    this.cancelGesture();
    this.gesture = gesture;
  }

  private cancelGesture() {
    if (!this.gestureActive) return;
    this.gestureActive = false;
    this.gesture?.cancel?.();
    this.map.dragPan.enable();
  }

  private wireGestures() {
    const el = this.map.getCanvasContainer();
    const local = (event: PointerEvent): Pt => { const r = el.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
    let start: Pt | null = null, moved = false;
    el.addEventListener('pointerdown', (event) => {
      this.swallowClick = false;
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1) { this.cancelGesture(); return; }
      if (!this.gesture) return;
      const point = local(event);
      if (!this.gesture.down(point, this.unproject(point))) return;
      this.gestureActive = true; this.swallowClick = true; start = point; moved = false;
      this.map.dragPan.disable();
      try { el.setPointerCapture(event.pointerId); } catch { /* synthetic pointers */ }
    });
    el.addEventListener('pointermove', (event) => {
      if (!this.gestureActive || !this.gesture || this.pointers.size > 1) return;
      const point = local(event);
      if (start && Math.hypot(point.x - start.x, point.y - start.y) > 4) moved = true;
      this.gesture.move?.(point, this.unproject(point));
    });
    const finish = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      if (!this.gestureActive) return;
      this.gestureActive = false;
      this.map.dragPan.enable();
      const point = local(event);
      this.gesture?.up?.(point, this.unproject(point), moved);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', (event) => { this.pointers.delete(event.pointerId); this.cancelGesture(); });
  }

  lngLatAt(point: Pt): LngLat { const l = this.map.unproject([point.x, point.y]); return [l.lng, l.lat]; }

  /** Centre on a place, zooming in far enough to act on it. */
  focus(at: LngLat, zoom = 17.2) { this.map.easeTo({ center: at, zoom: Math.max(this.map.getZoom(), zoom), duration: 450, padding: { top: 90, bottom: 280, left: 0, right: 0 } }); }

  fitTo(bounds: [[number, number], [number, number]], padding: number | { top: number; bottom: number; left: number; right: number } = 40) {
    this.map.fitBounds(bounds, { padding, duration: 0, maxZoom: 17.2 });
  }
  get paintedCount() { return this.applied; }
  /** Diagnostics for the soak test: what the map currently holds (a steady rise across identical actions is a leak). */
  debugCounts() {
    const style = this.map.style as unknown as { sourceCaches?: Record<string, { _tiles?: Record<string, unknown>; getIds?: () => string[] }> };
    const tiles = Object.fromEntries(Object.entries(style.sourceCaches ?? {}).map(([id, cache]) => [id, Object.keys(cache._tiles ?? {}).length]));
    return { tiles, layers: this.map.getStyle().layers?.length ?? 0, sources: Object.keys(this.map.getStyle().sources ?? {}).length, providers: providers.size };
  }
  destroy() { this.unbind?.(); providers.delete(this.token); this.map.remove(); }
}

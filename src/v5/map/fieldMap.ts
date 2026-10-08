import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Network } from '../engine/types.ts';
import type { FieldStore } from '../store/store.ts';
import type { EntityKey, Status } from '../store/types.ts';

export const SEGMENT_SOURCE = 'v5-segments';
export const HOUSE_SOURCE = 'v5-houses';

export type Theme = 'dark' | 'light';

/** Vivid on a dark basemap (the default); a deeper variant keeps the same contrast on the light basemap. */
const STATUS_PALETTE: Record<Theme, Record<Status, string>> = {
  dark: { open: '#ff8a3d', completed: '#3ee0b8', later: '#ffd24a', 'not-deliverable': '#8d9bb0' },
  light: { open: '#e8590c', completed: '#0b8f70', later: '#c98a00', 'not-deliverable': '#5f6f86' },
};
export const statusColors = (theme: Theme): Record<Status, string> => STATUS_PALETTE[theme];
export const STATUS_COLORS = STATUS_PALETTE.dark;

const BASEMAPS: Record<Theme, string> = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/bright',
};
const BLANK_BACKGROUND: Record<Theme, string> = { dark: '#0e1513', light: '#eef1ef' };
export const blankStyle = (theme: Theme): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': BLANK_BACKGROUND[theme] } }] });
const CASING: Record<Theme, string> = { dark: 'rgba(7,11,10,0.92)', light: 'rgba(255,255,255,0.92)' };
const OUTLINE: Record<Theme, string> = { dark: 'rgba(7,11,10,0.55)', light: 'rgba(32,33,36,0.45)' };
const SELECTED_OUTLINE: Record<Theme, string> = { dark: '#ffffff', light: '#202124' };

const statusMatch = (theme: Theme): ExpressionSpecification => {
  const c = STATUS_PALETTE[theme];
  return ['match', ['coalesce', ['feature-state', 'status'], 'open'], 'completed', c.completed, 'later', c.later, 'not-deliverable', c['not-deliverable'], c.open];
};

export type Hit = { kind: 'segment' | 'house'; id: string };
export type FieldMapOptions = {
  container: HTMLElement;
  /** Override the basemaps (tests); by default OpenFreeMap dark/bright follow `theme`. */
  styles?: Partial<Record<Theme, string | StyleSpecification>>;
  theme?: Theme;
  center?: [number, number];
  zoom?: number;
  onHit?: (hit: Hit | null) => void;
  /** Route marking only cares about street segments; houses must not swallow those taps. */
  segmentsOnly?: () => boolean;
};

export function networkToGeoJson(network: Network): { segments: FeatureCollection; houses: FeatureCollection } {
  const segments: Feature[] = [];
  for (const s of network.segments) {
    if (!s.visible) continue;
    segments.push({ type: 'Feature', id: s.id, properties: { key: `s:${s.id}`, name: s.name ?? '', cls: s.cls }, geometry: { type: 'LineString', coordinates: s.coords } });
  }
  const houses: Feature[] = network.houses.map((h) => ({
    type: 'Feature', id: h.id, properties: { key: `h:${h.id}`, num: h.number ?? '' }, geometry: { type: 'Polygon', coordinates: [h.ring] },
  }));
  return { segments: { type: 'FeatureCollection', features: segments }, houses: { type: 'FeatureCollection', features: houses } };
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
  private selected: EntityKey | null = null;
  private network: Network | null = null;
  private store: FieldStore | null = null;
  private unbind: (() => void) | null = null;
  private previewed = new Set<EntityKey>();
  private applied = 0;
  private styleFallback = false;
  /** The style URL we are currently waiting for; a failed theme switch must also fall back (the old style is still 'loaded'). */
  private expectedStyle: string | StyleSpecification;
  private ready: Promise<void>;
  private resolveReady!: () => void;

  constructor(private readonly options: FieldMapOptions) {
    this.theme = options.theme ?? 'dark';
    this.expectedStyle = this.styleFor(this.theme);
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.map = new maplibregl.Map({
      container: options.container, style: this.styleFor(this.theme), center: options.center ?? [13.0, 51.0],
      zoom: options.zoom ?? 15, attributionControl: { compact: true }, fadeDuration: 0, pitchWithRotate: false,
      maxPitch: 0, dragRotate: true,
    });
    // Test/diagnostic handle, only with ?debug in the URL.
    if (typeof location !== 'undefined' && location.search.includes('debug')) (window as unknown as { __v5Map?: MlMap }).__v5Map = this.map;
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    this.map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right');
    this.map.on('style.load', () => this.install());
    // Self-heal: a style swap that was superseded or fell back can finish without a usable `style.load`; whenever the
    // map is idle on a loaded style that lacks our sources, install them again.
    this.map.on('idle', () => { if (this.map.isStyleLoaded() && !this.map.getSource(SEGMENT_SOURCE)) this.install(); });
    // Field work must survive a basemap outage: if the style itself cannot be fetched, fall back to a plain background.
    this.map.on('error', (event) => {
      const failedUrl = (event as { error?: { url?: string } }).error?.url;
      if (this.styleFallback || !failedUrl || failedUrl !== this.expectedStyle) return;
      this.styleFallback = true;
      this.map.setStyle(blankStyle(this.theme));
    });
    this.map.on('click', (event) => {
      // A house is hit only when the tap lies inside it; streets get a forgiving 12 px halo.
      if (!options.segmentsOnly?.()) {
        const houses = this.map.queryRenderedFeatures(event.point, { layers: ['v5-houses-fill'] });
        if (houses.length) return options.onHit?.({ kind: 'house', id: String(houses[0].id).slice(2) });
      }
      const box: [[number, number], [number, number]] = [[event.point.x - 12, event.point.y - 12], [event.point.x + 12, event.point.y + 12]];
      const segments = this.map.queryRenderedFeatures(box, { layers: ['v5-segments-line'] });
      options.onHit?.(segments.length ? { kind: 'segment', id: String(segments[0].id).slice(2) } : null);
    });
  }

  private styleFor(theme: Theme): string | StyleSpecification {
    return this.options.styles?.[theme] ?? BASEMAPS[theme];
  }

  /** Runs after every style load (first load and theme switches): layers, then geometry, then status. */
  private install() {
    const map = this.map;
    if (map.getSource(SEGMENT_SOURCE)) return;
    this.installLayers();
    if (this.network) this.pushNetwork(this.network);
    if (this.store) void this.applyChunked([...this.store.entries()].map(([key, entry]) => [key, entry.status] as [EntityKey, Status]));
    this.previewed = new Set(); // feature-state died with the old sources
    this.selected = null;
    this.resolveReady();
  }

  private installLayers() {
    const map = this.map, theme = this.theme;
    map.addSource(SEGMENT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'key', tolerance: 0.2 });
    map.addSource(HOUSE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'key', tolerance: 0.1 });
    const selectedOn: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    // Zoomed out, houses become status-coloured dots: the whole city reads as progress, not as a block of lines.
    map.addLayer({
      id: 'v5-houses-dots', type: 'circle', source: HOUSE_SOURCE, minzoom: 11.5, maxzoom: 15.2,
      paint: {
        'circle-color': statusMatch(theme), 'circle-opacity': 0.92, 'circle-stroke-width': 0,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11.5, 0.7, 14, 1.6, 15.2, 3.2],
      },
    });
    map.addLayer({
      id: 'v5-houses-fill', type: 'fill', source: HOUSE_SOURCE, minzoom: 15.2,
      paint: { 'fill-color': statusMatch(theme), 'fill-opacity': ['case', selectedOn, 1, 0.88] },
    });
    map.addLayer({
      id: 'v5-houses-outline', type: 'line', source: HOUSE_SOURCE, minzoom: 16.5,
      paint: { 'line-color': ['case', selectedOn, SELECTED_OUTLINE[theme], OUTLINE[theme]], 'line-width': ['case', selectedOn, 2.5, 0.6] },
    });
    map.addLayer({
      id: 'v5-segments-casing', type: 'line', source: SEGMENT_SOURCE, minzoom: 13.5,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': CASING[theme],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13.5, 2, 16, 8, 20, 22],
      },
    });
    map.addLayer({
      id: 'v5-segments-preview', type: 'line', source: SEGMENT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#7aa8ff', 'line-opacity': ['case', ['boolean', ['feature-state', 'preview'], false], 0.9, 0],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 6, 16, 17, 20, 40], 'line-blur': 1,
      },
    });
    // Thin and translucent when zoomed far out, so a whole city reads as texture, not as one solid block.
    map.addLayer({
      id: 'v5-segments-line', type: 'line', source: SEGMENT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': statusMatch(theme),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.55, 14, 0.95],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'],
          10, ['case', selectedOn, 3, 0.5], 13, ['case', selectedOn, 4, 1.1], 16, ['case', selectedOn, 10, 5], 20, ['case', selectedOn, 26, 15]],
      },
    });
    // House numbers need a glyph endpoint; a style without one (tests, offline stub) simply has no labels.
    if (map.getStyle().glyphs) map.addLayer({
      id: 'v5-houses-number', type: 'symbol', source: HOUSE_SOURCE, minzoom: 17.5,
      layout: { 'text-field': ['get', 'num'], 'text-size': 11, 'text-allow-overlap': false, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': theme === 'dark' ? '#0b0f0e' : '#202124', 'text-halo-color': theme === 'dark' ? 'rgba(255,255,255,0.85)' : '#ffffff', 'text-halo-width': 1.2 },
    });
  }

  private pushNetwork(network: Network) {
    const data = networkToGeoJson(network);
    (this.map.getSource(SEGMENT_SOURCE) as GeoJSONSource).setData(data.segments);
    (this.map.getSource(HOUSE_SOURCE) as GeoJSONSource).setData(data.houses);
  }

  /** Swap the basemap; our layers, geometry and statuses are re-installed on `style.load`. */
  setTheme(theme: Theme) {
    if (theme === this.theme) return;
    this.theme = theme;
    this.styleFallback = false;
    this.expectedStyle = this.styleFor(theme);
    this.map.setStyle(this.expectedStyle);
  }

  /** Replace geometry (rare: a new area pack). Status is re-applied from the store afterwards. */
  async loadNetwork(network: Network): Promise<void> {
    await this.ready;
    this.network = network;
    this.pushNetwork(network);
    this.map.removeFeatureState({ source: SEGMENT_SOURCE });
    this.map.removeFeatureState({ source: HOUSE_SOURCE });
    this.selected = null;
  }

  /** Mirror the store into feature-state: initial restore, then only the changed keys. */
  bind(store: FieldStore): void {
    this.unbind?.();
    this.store = store;
    void this.applyChunked([...store.entries()].map(([key, entry]) => [key, entry.status] as [EntityKey, Status]));
    this.unbind = store.subscribe((changes) => { for (const [key, status] of changes) this.paint(key, status); });
  }

  private paint(key: EntityKey, status: Status) {
    const source = key.startsWith('h:') ? HOUSE_SOURCE : SEGMENT_SOURCE;
    if (!this.map.getSource(source)) return;
    this.map.setFeatureState({ source, id: key }, { status });
    this.applied++;
  }

  private async applyChunked(entries: [EntityKey, Status][]) {
    await this.ready;
    for (let i = 0; i < entries.length; i += 4000) {
      for (const [key, status] of entries.slice(i, i + 4000)) this.paint(key, status);
      if (i + 4000 < entries.length) await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  select(key: EntityKey | null) {
    const set = (k: EntityKey, selected: boolean) => {
      const source = k.startsWith('h:') ? HOUSE_SOURCE : SEGMENT_SOURCE;
      if (this.map.getSource(source)) this.map.setFeatureState({ source, id: k }, { selected });
    };
    if (this.selected) set(this.selected, false);
    this.selected = key;
    if (key) set(key, true);
  }

  /** Highlight a candidate route (smart marking preview) without touching status. */
  setPreview(keys: EntityKey[]) {
    if (!this.map.getSource(SEGMENT_SOURCE)) return;
    const next = new Set(keys);
    for (const key of this.previewed) if (!next.has(key)) this.map.setFeatureState({ source: SEGMENT_SOURCE, id: key }, { preview: false });
    for (const key of next) if (!this.previewed.has(key)) this.map.setFeatureState({ source: SEGMENT_SOURCE, id: key }, { preview: true });
    this.previewed = next;
  }

  fitTo(bounds: [[number, number], [number, number]], padding: number | { top: number; bottom: number; left: number; right: number } = 40) {
    this.map.fitBounds(bounds, { padding, duration: 0, maxZoom: 17.2 });
  }
  get paintedCount() { return this.applied; }
  destroy() { this.unbind?.(); this.map.remove(); }
}

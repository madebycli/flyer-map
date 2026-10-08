import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MlMap, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection } from 'geojson';
import type { Network } from '../engine/types.ts';
import type { FieldStore } from '../store/store.ts';
import type { EntityKey, Status } from '../store/types.ts';

export const SEGMENT_SOURCE = 'v5-segments';
export const HOUSE_SOURCE = 'v5-houses';

/** Status palette; colour-blind safe pairing of teal (done) and orange (open). */
export const STATUS_COLORS: Record<Status, string> = {
  open: '#e8710a', completed: '#14857a', later: '#f2c200', 'not-deliverable': '#80868b',
};

const statusMatch = (property: 'status'): ExpressionSpecification => [
  'match', ['coalesce', ['feature-state', property], 'open'],
  'completed', STATUS_COLORS.completed, 'later', STATUS_COLORS.later, 'not-deliverable', STATUS_COLORS['not-deliverable'],
  STATUS_COLORS.open,
];

export type Hit = { kind: 'segment' | 'house'; id: string };
export type FieldMapOptions = {
  container: HTMLElement;
  style?: string | StyleSpecification;
  center?: [number, number];
  zoom?: number;
  onHit?: (hit: Hit | null) => void;
};

const BLANK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f1f3f4' } }] };

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
 * re-serialises or re-tiles geometry.
 */
export class FieldMap {
  readonly map: MlMap;
  private selected: EntityKey | null = null;
  private unbind: (() => void) | null = null;
  private ready: Promise<void>;
  private applied = 0;

  constructor(private readonly options: FieldMapOptions) {
    this.map = new maplibregl.Map({
      container: options.container, style: options.style ?? BLANK_STYLE, center: options.center ?? [13.0, 51.0],
      zoom: options.zoom ?? 15, attributionControl: { compact: true }, fadeDuration: 0, pitchWithRotate: false,
      maxPitch: 0, dragRotate: true,
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
    this.map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'top-right');
    this.ready = new Promise((resolve) => this.map.once('load', () => { this.installLayers(); resolve(); }));
    this.map.on('click', (event) => {
      const box: [[number, number], [number, number]] = [[event.point.x - 10, event.point.y - 10], [event.point.x + 10, event.point.y + 10]];
      const houses = this.map.queryRenderedFeatures(box, { layers: ['v5-houses-fill'] });
      if (houses.length) return options.onHit?.({ kind: 'house', id: String(houses[0].id).slice(2) });
      const segments = this.map.queryRenderedFeatures(box, { layers: ['v5-segments-line'] });
      options.onHit?.(segments.length ? { kind: 'segment', id: String(segments[0].id).slice(2) } : null);
    });
  }

  private installLayers() {
    const map = this.map;
    map.addSource(SEGMENT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'key', tolerance: 0.2 });
    map.addSource(HOUSE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'key', tolerance: 0.1 });
    const selectedOn: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
    map.addLayer({
      id: 'v5-houses-fill', type: 'fill', source: HOUSE_SOURCE, minzoom: 15.5,
      paint: { 'fill-color': statusMatch('status'), 'fill-opacity': ['case', selectedOn, 1, 0.82] },
    });
    map.addLayer({
      id: 'v5-houses-outline', type: 'line', source: HOUSE_SOURCE, minzoom: 16.5,
      paint: { 'line-color': ['case', selectedOn, '#202124', 'rgba(32,33,36,0.45)'], 'line-width': ['case', selectedOn, 2.5, 0.6] },
    });
    map.addLayer({
      id: 'v5-segments-casing', type: 'line', source: SEGMENT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-opacity': 0.9, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 2.5, 16, 8, 20, 22] },
    });
    map.addLayer({
      id: 'v5-segments-line', type: 'line', source: SEGMENT_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': statusMatch('status'),
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, ['case', selectedOn, 3.5, 1.5], 16, ['case', selectedOn, 10, 5], 20, ['case', selectedOn, 26, 15]],
      },
    });
    // House numbers need a glyph endpoint; a style without one (tests, offline stub) simply has no labels.
    if (map.getStyle().glyphs) map.addLayer({
      id: 'v5-houses-number', type: 'symbol', source: HOUSE_SOURCE, minzoom: 17.5,
      layout: { 'text-field': ['get', 'num'], 'text-size': 11, 'text-allow-overlap': false, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#202124', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  }

  /** Replace geometry (rare: a new area pack). Status is re-applied from the store afterwards. */
  async loadNetwork(network: Network): Promise<void> {
    await this.ready;
    const data = networkToGeoJson(network);
    (this.map.getSource(SEGMENT_SOURCE) as GeoJSONSource).setData(data.segments);
    (this.map.getSource(HOUSE_SOURCE) as GeoJSONSource).setData(data.houses);
    this.map.removeFeatureState({ source: SEGMENT_SOURCE });
    this.map.removeFeatureState({ source: HOUSE_SOURCE });
    this.selected = null;
  }

  /** Mirror the store into feature-state: initial restore, then only the changed keys. */
  bind(store: FieldStore): void {
    this.unbind?.();
    const restore = [...store.entries()].map(([key, entry]) => [key, entry.status] as [EntityKey, Status]);
    void this.applyChunked(restore);
    this.unbind = store.subscribe((changes) => { for (const [key, status] of changes) this.paint(key, status); });
  }

  private paint(key: EntityKey, status: Status) {
    const source = key.startsWith('h:') ? HOUSE_SOURCE : SEGMENT_SOURCE;
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
    const set = (k: EntityKey, selected: boolean) => this.map.setFeatureState({ source: k.startsWith('h:') ? HOUSE_SOURCE : SEGMENT_SOURCE, id: k }, { selected });
    if (this.selected) set(this.selected, false);
    this.selected = key;
    if (key) set(key, true);
  }

  /** Highlight a candidate route (smart marking preview) without touching status. */
  get paintedCount() { return this.applied; }
  destroy() { this.unbind?.(); this.map.remove(); }
}

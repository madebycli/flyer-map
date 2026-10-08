import type { Feature, FeatureCollection } from 'geojson';
import type { Network } from './types.ts';

export type MapGeoJson = { segments: FeatureCollection; houses: FeatureCollection; centers: FeatureCollection };

/**
 * The GeoJSON counterpart of the Rust tile layers (same three layers, same `key`/`num` properties) for the TypeScript
 * fallback path. Networks are merged "first Area wins", hidden street pieces are not drawn.
 */
export function networksToGeoJson(networks: Network[]): MapGeoJson {
  const segments: Feature[] = [], houses: Feature[] = [], centers: Feature[] = [];
  const seenS = new Set<string>(), seenH = new Set<string>();
  for (const network of networks) {
    for (const s of network.segments) {
      if (seenS.has(s.id)) continue;
      seenS.add(s.id);
      if (!s.visible) continue;
      segments.push({ type: 'Feature', id: s.id, properties: { key: `s:${s.id}`, cls: s.cls }, geometry: { type: 'LineString', coordinates: s.coords } });
    }
    for (const h of network.houses) {
      if (seenH.has(h.id)) continue;
      seenH.add(h.id);
      houses.push({ type: 'Feature', id: h.id, properties: { key: `h:${h.id}`, num: h.number ?? '' }, geometry: { type: 'Polygon', coordinates: [h.ring] } });
      centers.push({ type: 'Feature', id: h.id, properties: { key: `h:${h.id}` }, geometry: { type: 'Point', coordinates: h.center } });
    }
  }
  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });
  return { segments: fc(segments), houses: fc(houses), centers: fc(centers) };
}

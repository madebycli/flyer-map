import 'maplibre-gl/dist/maplibre-gl.css';
import { deriveNetwork } from '../engine/derive.ts';
import { syntheticCity } from '../engine/synthetic.ts';
import { FieldMap, blankStyle } from '../map/fieldMap.ts';
import { FieldStore } from '../store/store.ts';
import type { Network } from '../engine/types.ts';
import { networksToGeoJson } from '../engine/geojson.ts';

declare global { interface Window { harness: unknown } }

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

window.harness = {
  async run(blocks: number) {
    const city = syntheticCity(blocks, blocks);
    let t = performance.now();
    const network: Network = deriveNetwork(city.raw);
    const deriveMs = performance.now() - t;
    const store = new FieldStore('harness');
    const hits: unknown[] = [];
    const fieldMap = new FieldMap({
      container: document.getElementById('map')!, zoom: 16.8, styles: { dark: blankStyle('dark') },
      center: [13.0 + (blocks * 50) / 70_000, 51.0 + (blocks * 50) / 110_574], onHit: (h) => hits.push(h),
    });
    (window as unknown as { fm: FieldMap }).fm = fieldMap;
    t = performance.now();
    await fieldMap.loadMapData({ kind: 'geojson', ...networksToGeoJson([network]) }, async () => new ArrayBuffer(0));
    fieldMap.bind(store);
    await new Promise<void>((r) => fieldMap.map.once('idle', () => r()));
    const loadMs = performance.now() - t;
    // Paint a few thousand statuses, as a bulk "route marking" would.
    const keys = network.houses.slice(0, 5000).map((h) => `h:${h.id}`);
    t = performance.now();
    store.set(keys, 'completed');
    await new Promise((r) => setTimeout(r, 0));
    const paintCallMs = performance.now() - t;
    await new Promise<void>((r) => fieldMap.map.once('idle', () => r()));
    // Single status change on screen.
    const oneKey = keys[0];
    t = performance.now();
    store.set(oneKey, 'later');
    await new Promise((r) => setTimeout(r, 0));
    const oneMs = performance.now() - t;
    await nextFrame();
    const state = fieldMap.map.getFeatureState({ source: 'v5-houses', id: oneKey });
    const stateDone = fieldMap.map.getFeatureState({ source: 'v5-houses', id: keys[1] });
    return {
      houses: network.houses.length, segments: network.segments.filter((s) => s.visible).length,
      deriveMs: Math.round(deriveMs), loadMs: Math.round(loadMs), paintCallMs: +paintCallMs.toFixed(1), oneChangeMs: +oneMs.toFixed(2),
      state, stateDone, painted: fieldMap.paintedCount, hits,
    };
  },
  center(): [number, number] { const c = (window as unknown as { fm: FieldMap }).fm.map.getCenter(); return [c.lng, c.lat]; },
  async queryAtCenter() {
    const fm = (window as unknown as { fm: FieldMap }).fm;
    const features = fm.map.queryRenderedFeatures(undefined, { layers: ['v5-houses-fill'] });
    return { houses: features.length, sample: features.slice(0, 3).map((f) => f.id) };
  },
};

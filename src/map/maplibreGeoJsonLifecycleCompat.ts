import { GeoJSONSource } from "maplibre-gl";
import type { Map } from "maplibre-gl";

type GeoJsonData = Parameters<GeoJSONSource["setData"]>[0];
type GeoJsonSourceWithMap = GeoJSONSource & { map?: Map };

let installed = false;

/**
 * MapLibre's post-5.7 TileManager lifecycle can drop a GeoJSON setData() that
 * runs in the same style turn in which a source and its backing layers were
 * added. The next render performs style.recalculate(), marks the TileManager
 * as used and makes the update safe. See maplibre/maplibre-gl-js#7634.
 *
 * Keep the normal fast path unchanged once the style is loaded. This shim is
 * deliberately scoped to campaign-map loading from main.tsx and can be
 * removed once the upstream lifecycle no longer needs this compatibility gap.
 */
export function installMapLibreGeoJsonLifecycleCompat() {
  if (installed) return;
  installed = true;

  const originalSetData = GeoJSONSource.prototype.setData;

  GeoJSONSource.prototype.setData = function setDataAfterStyleRecalc(
    this: GeoJsonSourceWithMap,
    data: GeoJsonData,
  ): Promise<void> {
    const map = this.map;
    if (!map || map.isStyleLoaded()) return originalSetData.call(this, data);

    return new Promise<void>((resolve, reject) => {
      const apply = () => {
        try {
          originalSetData.call(this, data).then(resolve, reject);
        } catch (cause) {
          reject(cause);
        }
      };

      map.once("render", apply);
      map.triggerRepaint();
    });
  };
}

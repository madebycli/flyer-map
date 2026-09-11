import { GeoJSONSource } from "maplibre-gl";
import type { Map } from "maplibre-gl";

type GeoJsonData = Parameters<GeoJSONSource["setData"]>[0];
type GeoJsonSourceWithMap = GeoJSONSource & { map?: Map };
type PendingWaiter = { resolve: () => void; reject: (cause: unknown) => void };
type PendingHydration = { data: GeoJsonData; waiters: PendingWaiter[] };
type DiagnosticPhase = "queued" | "applied";

const APPLICATION_SOURCE_PREFIX = "vf-";
let installed = false;

function featureCount(data: GeoJsonData) {
  if (typeof data !== "object" || data === null) return null;
  const candidate = data as { type?: unknown; features?: unknown };
  if (candidate.type !== "FeatureCollection" || !Array.isArray(candidate.features)) return null;
  return candidate.features.length;
}

function recordFeatureCount(map: Map, sourceId: string, phase: DiagnosticPhase, data: GeoJsonData) {
  const count = featureCount(data);
  if (count === null) return;
  const region = map.getContainer().closest<HTMLElement>(".map-region");
  if (!region) return;

  const suffix =
    sourceId === "vf-areas"
      ? "Areas"
      : sourceId === "vf-streets"
        ? "Streets"
        : sourceId === "vf-houses"
          ? "Houses"
          : null;
  if (!suffix) return;
  region.dataset[`${phase}${suffix}`] = String(count);
}

function afterInitialStyleBoundary(map: Map, apply: () => void) {
  let completed = false;
  const view = map.getContainer().ownerDocument.defaultView;

  const finish = () => {
    if (completed) return;
    completed = true;
    map.off("render", finish);
    apply();
  };

  map.once("render", finish);
  map.triggerRepaint();

  if (!view) {
    window.setTimeout(finish, 0);
    return;
  }

  // A render requested from inside style.load can be absorbed by the render
  // already in progress. Cross-device diagnostics proved that waiting only for
  // map.once("render") can then leave every initial application setData()
  // unresolved forever. Cross one browser frame, request a fresh MapLibre
  // repaint from outside that style turn, then use the following frame as a
  // deterministic fallback after MapLibre had the first chance to recalculate.
  view.requestAnimationFrame(() => {
    if (completed) return;
    map.triggerRepaint();
    view.requestAnimationFrame(finish);
  });
}

/**
 * MapLibre's post-5.7 TileManager lifecycle can drop the first GeoJSON
 * setData() when a source and its backing layers were just added. The first
 * render performs style.recalculate(), marks the TileManager as used and makes
 * that hydration safe. See maplibre/maplibre-gl-js#7634.
 *
 * Do not use map.isStyleLoaded() as the gate here: style.load may already have
 * fired while newly-added application sources still have not crossed their
 * first render/recalculate boundary. Coalesce every setData() for a new `vf-*`
 * source, prefer the next MapLibre render, and guarantee completion with a
 * two-frame fallback if that render event is absorbed by the current turn.
 */
export function installMapLibreGeoJsonLifecycleCompat() {
  if (installed) return;
  installed = true;

  const originalSetData = GeoJSONSource.prototype.setData;
  const hydratedSources = new WeakSet<GeoJSONSource>();
  const pendingHydrations = new WeakMap<GeoJSONSource, PendingHydration>();

  GeoJSONSource.prototype.setData = function setDataAfterInitialStyleRecalc(
    this: GeoJsonSourceWithMap,
    data: GeoJsonData,
  ): Promise<void> {
    const map = this.map;
    if (map) recordFeatureCount(map, this.id, "queued", data);

    if (!map || !this.id.startsWith(APPLICATION_SOURCE_PREFIX) || hydratedSources.has(this)) {
      const update = originalSetData.call(this, data);
      if (map) {
        void update.then(
          () => recordFeatureCount(map, this.id, "applied", data),
          () => undefined,
        );
      }
      return update;
    }

    const pending = pendingHydrations.get(this);
    if (pending) {
      pending.data = data;
      return new Promise<void>((resolve, reject) => {
        pending.waiters.push({ resolve, reject });
      });
    }

    return new Promise<void>((resolve, reject) => {
      pendingHydrations.set(this, { data, waiters: [{ resolve, reject }] });

      const apply = () => {
        const latest = pendingHydrations.get(this);
        pendingHydrations.delete(this);
        hydratedSources.add(this);
        if (!latest) return;

        try {
          originalSetData.call(this, latest.data).then(
            () => {
              recordFeatureCount(map, this.id, "applied", latest.data);
              for (const waiter of latest.waiters) waiter.resolve();
            },
            (cause) => {
              for (const waiter of latest.waiters) waiter.reject(cause);
            },
          );
        } catch (cause) {
          for (const waiter of latest.waiters) waiter.reject(cause);
        }
      };

      afterInitialStyleBoundary(map, apply);
    });
  };
}

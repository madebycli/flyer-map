const OPENFREE_MAP_BRIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const OPENFREE_MAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet/latest";
const OPENFREE_MAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OSM_RASTER_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

let installed = false;

export function buildResilientFieldMapStyle() {
  return {
    version: 8 as const,
    name: "Flyer Map resilient field basemap",
    glyphs: OPENFREE_MAP_GLYPHS_URL,
    sources: {
      osm: {
        type: "raster" as const,
        tiles: [OSM_RASTER_TILE_URL],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      openmaptiles: {
        type: "vector" as const,
        url: OPENFREE_MAP_TILEJSON_URL,
        attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
      },
      "vf-empty-label-anchor": {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
      },
    },
    layers: [
      { id: "vf-osm-raster-basemap", type: "raster" as const, source: "osm" },
      {
        id: "vf-basemap-label-anchor",
        type: "symbol" as const,
        source: "vf-empty-label-anchor",
        layout: { "text-field": "" },
      },
    ],
  };
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export async function fetchWithFieldMapStyleRecovery(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (requestUrl(input) !== OPENFREE_MAP_BRIGHT_STYLE_URL) return fetchImpl(input, init);

  return new Response(JSON.stringify(buildResilientFieldMapStyle()), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function installFieldMapStyleRecovery() {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithFieldMapStyleRecovery(originalFetch, input, init)) as typeof fetch;
}

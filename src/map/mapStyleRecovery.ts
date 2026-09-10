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

function usableBrightStyle(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const style = value as {
    version?: unknown;
    sources?: unknown;
    layers?: unknown;
  };
  if (style.version !== 8 || !style.sources || typeof style.sources !== "object" || Array.isArray(style.sources)) {
    return false;
  }
  const sources = style.sources as Record<string, unknown>;
  if (!("openmaptiles" in sources) || !Array.isArray(style.layers) || style.layers.length === 0) return false;
  return style.layers.some((layer) => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) return false;
    return (layer as { type?: unknown }).type === "symbol";
  });
}

function fallbackStyleResponse() {
  return new Response(JSON.stringify(buildResilientFieldMapStyle()), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function fetchWithFieldMapStyleRecovery(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  if (requestUrl(input) !== OPENFREE_MAP_BRIGHT_STYLE_URL) return fetchImpl(input, init);

  try {
    const response = await fetchImpl(input, init);
    if (!response.ok) return fallbackStyleResponse();
    try {
      const parsed = await response.clone().json() as unknown;
      if (usableBrightStyle(parsed)) return response;
    } catch {
      // Invalid provider JSON falls through to the deterministic fallback style.
    }
  } catch {
    // Transport failures use the deterministic fallback style.
  }
  return fallbackStyleResponse();
}

export function installFieldMapStyleRecovery() {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithFieldMapStyleRecovery(originalFetch, input, init)) as typeof fetch;
}

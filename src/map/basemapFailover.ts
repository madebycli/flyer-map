const OPENFREE_MAP_BRIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const OPENFREE_MAP_VECTOR_TILE_URL = "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";
const OPENFREE_MAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OSM_RASTER_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const STYLE_REQUEST_TIMEOUT_MS = 4_000;

let installed = false;

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function emergencyBasemapStyle() {
  return {
    version: 8 as const,
    name: "Flyer Map emergency basemap",
    glyphs: OPENFREE_MAP_GLYPHS_URL,
    sources: {
      // Keep the source contract expected by MapView even when the Bright
      // style document itself is unavailable. Using direct ZXY tiles avoids
      // making style installation depend on a second TileJSON request.
      openmaptiles: {
        type: "vector" as const,
        tiles: [OPENFREE_MAP_VECTOR_TILE_URL],
        minzoom: 0,
        maxzoom: 14,
        attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
      },
      "vf-emergency-osm": {
        type: "raster" as const,
        tiles: [OSM_RASTER_TILE_URL],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      "vf-emergency-label-anchor": {
        type: "geojson" as const,
        data: { type: "FeatureCollection" as const, features: [] },
      },
    },
    layers: [
      {
        id: "vf-emergency-osm-raster",
        type: "raster" as const,
        source: "vf-emergency-osm",
      },
      // MapView inserts normal Area/Street/House context below the first
      // symbol layer and interaction overlays above it. Preserve that exact
      // insertion contract so emergency basemap mode never suppresses the
      // application layers.
      {
        id: "vf-emergency-label-anchor",
        type: "symbol" as const,
        source: "vf-emergency-label-anchor",
        layout: { "text-field": "" },
      },
    ],
  };
}

function emergencyStyleResponse() {
  return new Response(JSON.stringify(emergencyBasemapStyle()), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function timedFetch(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetchImpl(input, init);

  return new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("basemap_style_timeout")), timeoutMs);
    fetchImpl(input, init).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function fetchWithBasemapFailover(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = STYLE_REQUEST_TIMEOUT_MS,
) {
  if (requestUrl(input) !== OPENFREE_MAP_BRIGHT_STYLE_URL) return fetchImpl(input, init);

  try {
    const response = await timedFetch(fetchImpl, input, init, timeoutMs);
    if (response.ok) return response;
  } catch (error) {
    if (isAbortError(error)) throw error;
  }

  return emergencyStyleResponse();
}

export function installBasemapFailover() {
  if (installed || typeof globalThis.fetch !== "function") return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetchWithBasemapFailover(nativeFetch, input, init)) as typeof fetch;
}

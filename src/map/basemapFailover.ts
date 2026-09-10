const OPENFREE_MAP_BRIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/bright";
const OPENFREE_MAP_VECTOR_TILE_URL = "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";
const OPENFREE_MAP_GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const OSM_RASTER_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const STYLE_REQUEST_TIMEOUT_MS = 4_000;
const BASEMAP_VECTOR_SOURCE_ID = "openmaptiles";
const EMERGENCY_LABEL_ANCHOR_SOURCE_ID = "vf-emergency-label-anchor";
const EMERGENCY_LABEL_ANCHOR_LAYER_ID = "vf-emergency-label-anchor";

let installed = false;

type BasemapStyleDocument = {
  version?: number;
  name?: string;
  glyphs?: string;
  sources?: Record<string, unknown>;
  layers?: Array<{ id?: string; type?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function emergencyVectorSource() {
  return {
    type: "vector" as const,
    tiles: [OPENFREE_MAP_VECTOR_TILE_URL],
    minzoom: 0,
    maxzoom: 14,
    attribution: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
  };
}

function emergencyLabelAnchorSource() {
  return {
    type: "geojson" as const,
    data: { type: "FeatureCollection" as const, features: [] },
  };
}

function emergencyLabelAnchorLayer() {
  return {
    id: EMERGENCY_LABEL_ANCHOR_LAYER_ID,
    type: "symbol" as const,
    source: EMERGENCY_LABEL_ANCHOR_SOURCE_ID,
    layout: { "text-field": "" },
  };
}

function emergencyBasemapStyle() {
  return {
    version: 8 as const,
    name: "Flyer Map emergency basemap",
    glyphs: OPENFREE_MAP_GLYPHS_URL,
    sources: {
      // Keep the source contract expected by MapView even when the Bright
      // style document itself is unavailable. Direct ZXY vector tiles avoid
      // making application-layer installation depend on TileJSON metadata.
      [BASEMAP_VECTOR_SOURCE_ID]: emergencyVectorSource(),
      "vf-emergency-osm": {
        type: "raster" as const,
        tiles: [OSM_RASTER_TILE_URL],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      [EMERGENCY_LABEL_ANCHOR_SOURCE_ID]: emergencyLabelAnchorSource(),
    },
    layers: [
      {
        id: "vf-emergency-osm-raster",
        type: "raster" as const,
        source: "vf-emergency-osm",
      },
      emergencyLabelAnchorLayer(),
    ],
  };
}

function styleResponse(style: BasemapStyleDocument, original?: Response) {
  const headers = new Headers(original?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!original) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(style), {
    status: original?.status ?? 200,
    statusText: original?.statusText,
    headers,
  });
}

function emergencyStyleResponse() {
  return styleResponse(emergencyBasemapStyle());
}

function normalizeBrightStyle(style: BasemapStyleDocument) {
  if (style.version !== 8 || !style.sources || !Array.isArray(style.layers)) return null;

  const hasRequiredVectorSource = Boolean(style.sources[BASEMAP_VECTOR_SOURCE_ID]);
  const hasSymbolInsertionPoint = style.layers.some((layer) => layer.type === "symbol");
  const hasGlyphs = typeof style.glyphs === "string" && style.glyphs.length > 0;

  if (hasRequiredVectorSource && hasSymbolInsertionPoint && hasGlyphs) return style;

  const sources = { ...style.sources };
  const layers = [...style.layers];
  if (!hasRequiredVectorSource) sources[BASEMAP_VECTOR_SOURCE_ID] = emergencyVectorSource();
  if (!hasSymbolInsertionPoint) {
    if (!sources[EMERGENCY_LABEL_ANCHOR_SOURCE_ID]) {
      sources[EMERGENCY_LABEL_ANCHOR_SOURCE_ID] = emergencyLabelAnchorSource();
    }
    layers.push(emergencyLabelAnchorLayer());
  }

  return {
    ...style,
    glyphs: hasGlyphs ? style.glyphs : OPENFREE_MAP_GLYPHS_URL,
    sources,
    layers,
  };
}

async function healthyOrNormalizedBrightStyle(response: Response) {
  try {
    const style = await response.clone().json() as BasemapStyleDocument;
    const normalized = normalizeBrightStyle(style);
    if (!normalized) return null;
    if (normalized === style) return response;
    return styleResponse(normalized, response);
  } catch {
    return null;
  }
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
    if (response.ok) {
      const usableStyle = await healthyOrNormalizedBrightStyle(response);
      if (usableStyle) return usableStyle;
    }
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

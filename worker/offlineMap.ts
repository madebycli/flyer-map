import {
  OFFLINE_MAP_RADIUS_METERS,
  OFFLINE_MAP_SCHEMA_VERSION,
  isOfflineMapPackage,
  type OfflineMapBounds,
  type OfflineMapAreaGeometry,
  type OfflineMapBuildingFeature,
  type OfflineMapDataKind,
  type OfflineMapPackage,
  type OfflineMapRoadFeature,
} from "../src/domain/offlineMap.ts";

const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_AREA_OVERPASS_URLS = [
  "https://overpass.private.coffee/api/interpreter",
  DEFAULT_OVERPASS_URL,
] as const;
const OVERPASS_USER_AGENT = "flyer-map/1.0 (+https://github.com/madebycli/flyer-map)";
const MAX_REQUEST_BYTES = 4_096;
const MAX_UPSTREAM_BYTES = 8_000_000;
const MAX_PACKAGE_BYTES = 10_000_000;
const AREA_PREPARATION_MAX_AGGREGATE_BYTES = 32_000_000;
const UPSTREAM_TIMEOUT_MS = 18_000;
const AREA_UPSTREAM_TIMEOUT_MS = 10_000;
const AREA_BBOX_BUFFER_METERS = 120;
const AREA_PREPARATION_TILE_TARGET_METERS = 1_600;
const AREA_PREPARATION_MAX_TILE_AXIS = 4;
const AREA_PREPARATION_FETCH_CONCURRENCY = 3;
const MIN_RADIUS_METERS = 250;

const TAG_ALLOWLIST = new Set([
  "name",
  "ref",
  "highway",
  "building",
  "building:levels",
  "addr:housenumber",
  "addr:street",
  "addr:postcode",
  "addr:city",
  "surface",
  "service",
  "access",
  "foot",
  "bicycle",
  "motor_vehicle",
  "oneway",
  "lanes",
  "lit",
  "sidewalk",
]);

export type FetchLike = typeof fetch;

export type OfflineMapHandlerOptions = {
  upstreamUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  maxUpstreamBytes?: number;
  maxPackageBytes?: number;
};

type OverpassGeometryPoint = {
  lat: number;
  lon: number;
};

type OverpassWay = {
  type: "way";
  id: number;
  tags?: Record<string, unknown>;
  geometry?: OverpassGeometryPoint[];
};

export type OverpassPayload = {
  elements?: unknown[];
  osm3s?: {
    timestamp_osm_base?: unknown;
  };
};

export type OfflineMapRequestKind = OfflineMapDataKind;

export type ParsedRequest = {
  lat: number;
  lng: number;
  radiusMeters: number;
  kind: OfflineMapRequestKind;
};

export class OfflineMapRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "OfflineMapRequestError";
    this.status = status;
    this.code = code;
  }
}

export type OsmFeaturesForAreaLimits = {
  timeoutMs?: number;
  maxUpstreamBytes?: number;
  maxPackageBytes?: number;
  maxAggregateBytes?: number;
};

export type OsmFeaturesForAreaOptions = {
  geometry: OfflineMapAreaGeometry;
  upstreamUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  limits?: OsmFeaturesForAreaLimits;
};

export type OsmFeaturesForArea = {
  roads: OfflineMapRoadFeature[];
  buildings: OfflineMapBuildingFeature[];
  sourceTimestamp: string | null;
  fetchedAt: string;
  request: ParsedRequest;
};

/** A non-HTTP error contract for the canonical server-side Area OSM fetch. */
export class OsmFeaturesForAreaError extends Error {
  readonly code: "too_large" | "timeout" | "failed" | "invalid";

  constructor(code: "too_large" | "timeout" | "failed" | "invalid", message: string) {
    super(message);
    this.name = "OsmFeaturesForAreaError";
    this.code = code;
  }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

const errorResponse = (error: OfflineMapRequestError) =>
  json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    { status: error.status },
  );

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function parseRequest(request: Request): Promise<ParsedRequest> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new OfflineMapRequestError(413, "request_too_large", "Offline-Kartenanfrage ist zu groß.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new OfflineMapRequestError(413, "request_too_large", "Offline-Kartenanfrage ist zu groß.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OfflineMapRequestError(400, "invalid_json", "Request-Body ist kein gültiges JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new OfflineMapRequestError(400, "invalid_request", "Offline-Kartenanfrage ist ungültig.");
  }

  const body = parsed as Record<string, unknown>;
  const center = body.center;
  if (!center || typeof center !== "object" || Array.isArray(center)) {
    throw new OfflineMapRequestError(400, "invalid_center", "Kartenmittelpunkt ist ungültig.");
  }

  const point = center as Record<string, unknown>;
  if (
    !finiteNumber(point.lat) ||
    point.lat < -90 ||
    point.lat > 90 ||
    !finiteNumber(point.lng) ||
    point.lng < -180 ||
    point.lng > 180
  ) {
    throw new OfflineMapRequestError(400, "invalid_center", "Kartenmittelpunkt ist ungültig.");
  }

  const radius = body.radiusMeters ?? OFFLINE_MAP_RADIUS_METERS;
  if (
    !finiteNumber(radius) ||
    !Number.isInteger(radius) ||
    radius < MIN_RADIUS_METERS ||
    radius > OFFLINE_MAP_RADIUS_METERS
  ) {
    throw new OfflineMapRequestError(
      400,
      "invalid_radius",
      `Offline-Radius muss zwischen ${MIN_RADIUS_METERS} und ${OFFLINE_MAP_RADIUS_METERS} Metern liegen.`,
    );
  }

  const requestedKind = Object.prototype.hasOwnProperty.call(body, "kind")
    ? body.kind
    : "all";
  if (requestedKind !== "all" && requestedKind !== "roads" && requestedKind !== "buildings") {
    throw new OfflineMapRequestError(
      400,
      "invalid_kind",
      "Kartendaten-Typ ist ungültig.",
    );
  }
  const kind = requestedKind as OfflineMapRequestKind;

  return { lat: point.lat, lng: point.lng, radiusMeters: radius, kind };
}

function upstreamUrl(value: string | undefined) {
  let url: URL;
  try {
    url = new URL(value || DEFAULT_OVERPASS_URL);
  } catch {
    throw new OfflineMapRequestError(
      503,
      "osm_upstream_invalid",
      "OSM-Datenquelle ist serverseitig ungültig konfiguriert.",
    );
  }

  const localDevelopment =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new OfflineMapRequestError(
      503,
      "osm_upstream_invalid",
      "OSM-Datenquelle ist serverseitig ungültig konfiguriert.",
    );
  }
  return url.toString();
}

export function buildOfflineMapOverpassQuery(input: ParsedRequest) {
  const lat = input.lat.toFixed(6);
  const lng = input.lng.toFixed(6);
  const radius = String(input.radiusMeters);
  const kind = input.kind ?? "all";
  const around = `way(around:${radius},${lat},${lng})`;
  const selectors =
    kind === "roads"
      ? [`${around}["highway"];`]
      : kind === "buildings"
        ? [`${around}["building"];`]
        : [`${around}["highway"];`, `${around}["building"];`];

  return `[out:json][timeout:15];\n(\n  ${selectors.join("\n  ")}\n);\nout tags geom qt;`;
}

function areaBounds(geometry: OfflineMapAreaGeometry) {
  const points = geometry.coordinates.flat();
  if (
    points.length < 4 ||
    points.some(([lng, lat]) =>
      !finiteNumber(lng) || !finiteNumber(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90
    )
  ) {
    return null;
  }
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const rawSouth = Math.min(...lats);
  const rawWest = Math.min(...lngs);
  const rawNorth = Math.max(...lats);
  const rawEast = Math.max(...lngs);
  const centerLat = (rawSouth + rawNorth) / 2;
  const latPadding = AREA_BBOX_BUFFER_METERS / 111_320;
  const longitudeScale = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const lngPadding = AREA_BBOX_BUFFER_METERS / (111_320 * longitudeScale);
  return {
    south: Math.max(-90, rawSouth - latPadding),
    west: Math.max(-180, rawWest - lngPadding),
    north: Math.min(90, rawNorth + latPadding),
    east: Math.min(180, rawEast + lngPadding),
  };
}

type AreaBounds = NonNullable<ReturnType<typeof areaBounds>>;

function buildAreaPreparationQueryForBounds(bounds: AreaBounds) {
  const bbox = [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(7))
    .join(",");
  return `[out:json][timeout:8];\n(\n  way["highway"](${bbox});\n  way["building"](${bbox});\n);\nout tags geom qt;`;
}

function areaPreparationRequest(bounds: AreaBounds): ParsedRequest {
  const lat = (bounds.south + bounds.north) / 2;
  const lng = (bounds.west + bounds.east) / 2;
  const halfLatMeters = ((bounds.north - bounds.south) * 111_320) / 2;
  const longitudeScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const halfLngMeters = ((bounds.east - bounds.west) * 111_320 * longitudeScale) / 2;
  return {
    lat,
    lng,
    radiusMeters: Math.max(MIN_RADIUS_METERS, Math.ceil(Math.hypot(halfLatMeters, halfLngMeters))),
    kind: "all",
  };
}

function areaPreparationTileBounds(bounds: AreaBounds) {
  const centerLat = (bounds.south + bounds.north) / 2;
  const longitudeScale = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  const latSpanMeters = (bounds.north - bounds.south) * 111_320;
  const lngSpanMeters = (bounds.east - bounds.west) * 111_320 * longitudeScale;
  const rows = Math.max(
    1,
    Math.min(AREA_PREPARATION_MAX_TILE_AXIS, Math.ceil(latSpanMeters / AREA_PREPARATION_TILE_TARGET_METERS)),
  );
  const columns = Math.max(
    1,
    Math.min(AREA_PREPARATION_MAX_TILE_AXIS, Math.ceil(lngSpanMeters / AREA_PREPARATION_TILE_TARGET_METERS)),
  );
  const tiles: AreaBounds[] = [];
  for (let row = 0; row < rows; row += 1) {
    const south = bounds.south + ((bounds.north - bounds.south) * row) / rows;
    const north = bounds.south + ((bounds.north - bounds.south) * (row + 1)) / rows;
    for (let column = 0; column < columns; column += 1) {
      const west = bounds.west + ((bounds.east - bounds.west) * column) / columns;
      const east = bounds.west + ((bounds.east - bounds.west) * (column + 1)) / columns;
      tiles.push({ south, west, north, east });
    }
  }
  return tiles;
}

/**
 * Area preparation uses the canonical server-side Area BBox plus a small road-node
 * buffer. The hard ownership boundary remains the polygon clip before persistence.
 */
export function buildAreaPreparationOverpassQuery(geometry: OfflineMapAreaGeometry) {
  const bounds = areaBounds(geometry);
  return bounds ? buildAreaPreparationQueryForBounds(bounds) : null;
}

/** Large Areas are split only for upstream load control; polygon clipping remains authoritative. */
export function buildAreaPreparationOverpassQueries(geometry: OfflineMapAreaGeometry) {
  const bounds = areaBounds(geometry);
  if (!bounds) return [];
  return areaPreparationTileBounds(bounds).map(buildAreaPreparationQueryForBounds);
}

function normalizeTags(tags: Record<string, unknown> | undefined) {
  const result: Record<string, string> = {};
  if (!tags) return result;
  for (const [key, value] of Object.entries(tags)) {
    if (!TAG_ALLOWLIST.has(key)) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      continue;
    }
    result[key] = String(value).slice(0, 240);
  }
  return result;
}

function validWay(value: unknown): value is OverpassWay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const way = value as Record<string, unknown>;
  return way.type === "way" && Number.isSafeInteger(way.id) && Number(way.id) > 0;
}

function normalizeCoordinates(geometry: OverpassGeometryPoint[] | undefined) {
  if (!Array.isArray(geometry)) return [] as [number, number][];
  const result: [number, number][] = [];
  for (const point of geometry) {
    if (
      !point ||
      !finiteNumber(point.lat) ||
      !finiteNumber(point.lon) ||
      point.lat < -90 ||
      point.lat > 90 ||
      point.lon < -180 ||
      point.lon > 180
    ) {
      continue;
    }
    const coordinate: [number, number] = [point.lon, point.lat];
    const previous = result[result.length - 1];
    if (!previous || previous[0] !== coordinate[0] || previous[1] !== coordinate[1]) {
      result.push(coordinate);
    }
  }
  return result;
}

function normalizeRoad(way: OverpassWay): OfflineMapRoadFeature | null {
  if (!way.tags || typeof way.tags.highway !== "string") return null;
  const coordinates = normalizeCoordinates(way.geometry);
  if (coordinates.length < 2) return null;
  return {
    type: "Feature",
    id: `way/${way.id}`,
    properties: {
      osmType: "way",
      osmId: way.id,
      kind: "road",
      tags: normalizeTags(way.tags),
    },
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function normalizeBuilding(way: OverpassWay): OfflineMapBuildingFeature | null {
  if (!way.tags || typeof way.tags.building !== "string") return null;
  const coordinates = normalizeCoordinates(way.geometry);
  if (coordinates.length < 3) return null;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coordinates.push([first[0], first[1]]);
  }
  if (coordinates.length < 4) return null;
  return {
    type: "Feature",
    id: `way/${way.id}`,
    properties: {
      osmType: "way",
      osmId: way.id,
      kind: "building",
      tags: normalizeTags(way.tags),
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
}

function calculateBounds(lat: number, lng: number, radiusMeters: number): OfflineMapBounds {
  const latDelta = radiusMeters / 111_320;
  const longitudeScale = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = Math.min(radiusMeters / (111_320 * longitudeScale), 180);
  return {
    south: Math.max(-90, lat - latDelta),
    west: Math.max(-180, lng - lngDelta),
    north: Math.min(90, lat + latDelta),
    east: Math.min(180, lng + lngDelta),
  };
}

export function normalizeOfflineMapPackage(
  payload: OverpassPayload,
  input: ParsedRequest,
  fetchedAt: Date,
): OfflineMapPackage {
  const roads: OfflineMapRoadFeature[] = [];
  const buildings: OfflineMapBuildingFeature[] = [];
  const kind = input.kind ?? "all";

  for (const element of Array.isArray(payload.elements) ? payload.elements : []) {
    if (!validWay(element)) continue;
    if (kind !== "roads") {
      const building = normalizeBuilding(element);
      if (building) {
        buildings.push(building);
        if (kind === "all") continue;
      }
    }
    if (kind !== "buildings") {
      const road = normalizeRoad(element);
      if (road) roads.push(road);
    }
  }

  const timestamp = payload.osm3s?.timestamp_osm_base;
  const sourceTimestamp =
    typeof timestamp === "string" && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;

  return {
    schemaVersion: OFFLINE_MAP_SCHEMA_VERSION,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: fetchedAt.toISOString(),
    sourceTimestamp,
    center: { lat: input.lat, lng: input.lng },
    radiusMeters: input.radiusMeters,
    bounds: calculateBounds(input.lat, input.lng, input.radiusMeters),
    attribution: "© OpenStreetMap contributors",
    roads: { type: "FeatureCollection", features: roads },
    buildings: { type: "FeatureCollection", features: buildings },
  };
}

async function fetchOverpass(
  input: ParsedRequest,
  options: OfflineMapHandlerOptions,
): Promise<OverpassPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(upstreamUrl(options.upstreamUrl), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": OVERPASS_USER_AGENT,
      },
      body: new URLSearchParams({ data: buildOfflineMapOverpassQuery(input) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new OfflineMapRequestError(
        502,
        "osm_upstream_failed",
        "OSM-Daten konnten nicht geladen werden.",
      );
    }

    const maxBytes = options.maxUpstreamBytes ?? MAX_UPSTREAM_BYTES;
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new OfflineMapRequestError(
        413,
        "osm_response_too_large",
        "Der gewählte Offline-Bereich enthält zu viele Kartendaten.",
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new OfflineMapRequestError(
        413,
        "osm_response_too_large",
        "Der gewählte Offline-Bereich enthält zu viele Kartendaten.",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new OfflineMapRequestError(
        502,
        "osm_response_invalid",
        "OSM-Datenquelle hat ungültige Daten geliefert.",
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new OfflineMapRequestError(
        502,
        "osm_response_invalid",
        "OSM-Datenquelle hat ungültige Daten geliefert.",
      );
    }
    return payload as OverpassPayload;
  } catch (error) {
    if (error instanceof OfflineMapRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new OfflineMapRequestError(504, "osm_upstream_timeout", "OSM-Datenquelle hat zu lange gebraucht.");
    }
    throw new OfflineMapRequestError(502, "osm_upstream_failed", "OSM-Daten konnten nicht geladen werden.");
  } finally {
    clearTimeout(timeout);
  }
}

function areaFetchError(error: unknown) {
  if (error instanceof OfflineMapRequestError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OfflineMapRequestError(504, "osm_upstream_timeout", "OSM-Datenquelle hat zu lange gebraucht.");
  }
  return new OfflineMapRequestError(502, "osm_upstream_failed", "OSM-Daten konnten nicht geladen werden.");
}

function retryableAreaFetchError(error: OfflineMapRequestError) {
  return error.code === "osm_upstream_timeout" || error.code === "osm_upstream_failed" || error.code === "osm_response_invalid";
}

type AreaOverpassResponse = {
  payload: OverpassPayload;
  byteLength: number;
};

async function fetchAreaOverpass(
  query: string,
  options: OfflineMapHandlerOptions,
): Promise<AreaOverpassResponse> {
  const endpoints = options.upstreamUrl
    ? [upstreamUrl(options.upstreamUrl)]
    : DEFAULT_AREA_OVERPASS_URLS.map((value) => upstreamUrl(value));
  let lastError: OfflineMapRequestError | null = null;

  for (let index = 0; index < endpoints.length; index += 1) {
    const endpoint = endpoints[index];
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? AREA_UPSTREAM_TIMEOUT_MS,
    );
    try {
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": OVERPASS_USER_AGENT,
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new OfflineMapRequestError(
          response.status,
          "osm_upstream_failed",
          "OSM-Daten konnten nicht geladen werden.",
        );
      }

      const maxBytes = options.maxUpstreamBytes ?? MAX_UPSTREAM_BYTES;
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        throw new OfflineMapRequestError(
          413,
          "osm_response_too_large",
          "Der gewählte Area-Bereich enthält zu viele Kartendaten.",
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new OfflineMapRequestError(
          413,
          "osm_response_too_large",
          "Der gewählte Area-Bereich enthält zu viele Kartendaten.",
        );
      }

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new OfflineMapRequestError(
          502,
          "osm_response_invalid",
          "OSM-Datenquelle hat ungültige Daten geliefert.",
        );
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new OfflineMapRequestError(
          502,
          "osm_response_invalid",
          "OSM-Datenquelle hat ungültige Daten geliefert.",
        );
      }
      return { payload: payload as OverpassPayload, byteLength: bytes.byteLength };
    } catch (caught) {
      const error = areaFetchError(caught);
      lastError = error;
      if (!retryableAreaFetchError(error) || index === endpoints.length - 1) throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new OfflineMapRequestError(502, "osm_upstream_failed", "OSM-Daten konnten nicht geladen werden.");
}

type AreaOverpassFeatures = {
  roads: OfflineMapRoadFeature[];
  buildings: OfflineMapBuildingFeature[];
  sourceTimestamp: string | null;
};

async function fetchAreaOverpassQueries(
  queries: string[],
  options: OfflineMapHandlerOptions,
  maxAggregateBytes: number,
): Promise<AreaOverpassFeatures> {
  const roads = new Map<string, OfflineMapRoadFeature>();
  const buildings = new Map<string, OfflineMapBuildingFeature>();
  let sourceTimestamp: string | null = null;
  let aggregateBytes = 0;

  for (let offset = 0; offset < queries.length; offset += AREA_PREPARATION_FETCH_CONCURRENCY) {
    const batch = queries.slice(offset, offset + AREA_PREPARATION_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((query) => fetchAreaOverpass(query, options)));
    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;

      aggregateBytes += result.value.byteLength;
      if (aggregateBytes > maxAggregateBytes) {
        throw new OsmFeaturesForAreaError(
          "too_large",
          "OSM-Antworten überschreiten zusammen die Sicherheitsgrenze.",
        );
      }

      const payload = result.value.payload;
      if (!Array.isArray(payload.elements)) {
        throw new OsmFeaturesForAreaError("invalid", "OSM-Antwort enthält keine Way-Collection.");
      }

      const candidateTimestamp = payload.osm3s?.timestamp_osm_base;
      if (typeof candidateTimestamp === "string" && Number.isFinite(Date.parse(candidateTimestamp))) {
        if (!sourceTimestamp || Date.parse(candidateTimestamp) > Date.parse(sourceTimestamp)) {
          sourceTimestamp = candidateTimestamp;
        }
      }

      for (const element of payload.elements) {
        if (!validWay(element)) continue;
        const key = `${element.type}/${element.id}`;
        if (roads.has(key) || buildings.has(key)) continue;

        const building = normalizeBuilding(element);
        if (building) {
          buildings.set(key, building);
          continue;
        }
        const road = normalizeRoad(element);
        if (road) roads.set(key, road);
      }
    }
  }

  return {
    roads: [...roads.values()],
    buildings: [...buildings.values()],
    sourceTimestamp,
  };
}

/**
 * Fetches the two OSM feature classes for a persisted Area. The Area itself has
 * no 3-km offline-package limit. Large buffered BBoxes are tiled only to keep
 * individual Overpass requests bounded; exact Street ownership is still enforced
 * by polygon clipping before persistence.
 */
export async function fetchOsmFeaturesForArea(
  options: OsmFeaturesForAreaOptions,
): Promise<OsmFeaturesForArea> {
  const bounds = areaBounds(options.geometry);
  if (!bounds) {
    throw new OsmFeaturesForAreaError("invalid", "Area-Geometrie ist für den OSM-Abruf ungültig.");
  }
  const queries = buildAreaPreparationOverpassQueries(options.geometry);
  if (queries.length === 0) {
    throw new OsmFeaturesForAreaError("invalid", "Area-Geometrie ist für den OSM-Abruf ungültig.");
  }

  const request = areaPreparationRequest(bounds);
  const handlerOptions: OfflineMapHandlerOptions = {
    upstreamUrl: options.upstreamUrl,
    fetchImpl: options.fetchImpl,
    now: options.now,
    timeoutMs: options.limits?.timeoutMs,
    maxUpstreamBytes: options.limits?.maxUpstreamBytes,
    maxPackageBytes: options.limits?.maxPackageBytes,
  };

  try {
    const features = await fetchAreaOverpassQueries(
      queries,
      handlerOptions,
      options.limits?.maxAggregateBytes ?? AREA_PREPARATION_MAX_AGGREGATE_BYTES,
    );
    const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
    const serializedBytes = new TextEncoder().encode(JSON.stringify({
      roads: { type: "FeatureCollection", features: features.roads },
      buildings: { type: "FeatureCollection", features: features.buildings },
    })).byteLength;
    if (serializedBytes > (options.limits?.maxPackageBytes ?? AREA_PREPARATION_MAX_AGGREGATE_BYTES)) {
      throw new OsmFeaturesForAreaError("too_large", "OSM-Featuremenge überschreitet die Sicherheitsgrenze.");
    }
    return {
      roads: features.roads,
      buildings: features.buildings,
      sourceTimestamp: features.sourceTimestamp,
      fetchedAt,
      request,
    };
  } catch (error) {
    if (error instanceof OsmFeaturesForAreaError) throw error;
    if (error instanceof OfflineMapRequestError) {
      if (error.code === "osm_upstream_timeout") {
        throw new OsmFeaturesForAreaError("timeout", error.message);
      }
      if (error.code === "osm_response_invalid") {
        throw new OsmFeaturesForAreaError("invalid", error.message);
      }
      if (error.code === "osm_response_too_large") {
        throw new OsmFeaturesForAreaError("too_large", error.message);
      }
      throw new OsmFeaturesForAreaError("failed", error.message);
    }
    throw new OsmFeaturesForAreaError("failed", "OSM-Daten konnten nicht geladen werden.");
  }
}

export async function handleOfflineMapPackage(
  request: Request,
  options: OfflineMapHandlerOptions = {},
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse(
      new OfflineMapRequestError(405, "method_not_allowed", "Für diesen Endpunkt ist nur POST erlaubt."),
    );
  }

  try {
    const input = await parseRequest(request);
    const upstream = await fetchOverpass(input, options);
    const pkg = normalizeOfflineMapPackage(upstream, input, (options.now ?? (() => new Date()))());
    if (!isOfflineMapPackage(pkg)) {
      throw new OfflineMapRequestError(
        502,
        "offline_package_invalid",
        "Geladene OSM-Daten konnten nicht sicher verarbeitet werden.",
      );
    }

    const serialized = JSON.stringify(pkg);
    if (new TextEncoder().encode(serialized).byteLength > (options.maxPackageBytes ?? MAX_PACKAGE_BYTES)) {
      throw new OfflineMapRequestError(
        413,
        "offline_package_too_large",
        "Der gewählte Offline-Bereich ist für dieses Gerätedatenpaket zu groß.",
      );
    }

    return new Response(serialized, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof OfflineMapRequestError) return errorResponse(error);
    return errorResponse(
      new OfflineMapRequestError(500, "offline_package_failed", "Offline-Kartenbereich konnte nicht erstellt werden."),
    );
  }
}

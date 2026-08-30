import type { LngLat } from "../src/domain/campaign.ts";
import type { PickupSource } from "../src/domain/pickup.ts";
import {
  resolvePersistentAccess,
  type AccessContext,
} from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { resolveCollectionAccess } from "./collectionAccess.ts";
import { hasPickupReadSchema } from "./pickupRepository.ts";

const GEOAPIFY_AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const MAX_QUERY_LENGTH = 120;
const MAX_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 2_500;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export type PickupSearchEnv = {
  DB?: D1DatabaseLike;
  GEOAPIFY_API_KEY?: string;
  PICKUP_SEARCH_LIMITER?: RateLimitBinding;
};

type MainAreaRow = {
  geometry_json: string;
};

type CollectorCapabilityRow = {
  can_create_pickups: number;
};

type GeoapifyResult = Record<string, unknown>;

type SearchAccessResult =
  | { ok: true; access: AccessContext }
  | { ok: false; response: Response };

export type PickupAddressSearchResult = {
  id: string;
  title: string;
  address: string;
  position: LngLat;
  source: Extract<PickupSource, { kind: "osm-address" }>;
};

export const PICKUP_SEARCH_ATTRIBUTION = {
  provider: {
    text: "Powered by Geoapify",
    href: "https://www.geoapify.com/",
  },
  data: {
    text: "© OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright",
  },
} as const;

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    isFiniteNumber(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function samePoint(left: LngLat, right: LngLat) {
  return left[0] === right[0] && left[1] === right[1];
}

export function parsePickupSearchPolygon(value: unknown): LngLat[] | null {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    return null;
  }
  if (value.coordinates.length !== 1 || !Array.isArray(value.coordinates[0])) return null;
  const ring = value.coordinates[0];
  if (ring.length < 4 || !ring.every(isLngLat)) return null;
  const points = ring as LngLat[];
  if (!samePoint(points[0], points[points.length - 1])) return null;
  return points;
}

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    x >= Math.min(x1, x2) - 1e-10 &&
    x <= Math.max(x1, x2) + 1e-10 &&
    y >= Math.min(y1, y2) - 1e-10 &&
    y <= Math.max(y1, y2) + 1e-10
  );
}

export function pickupSearchPointInPolygon(point: LngLat, ring: LngLat[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const [x, y] = point;
    const [xi, yi] = currentPoint;
    const [xj, yj] = previousPoint;
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonBounds(ring: LngLat[]) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return { minLng, minLat, maxLng, maxLat };
}

function normalizeQuery(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length >= 2 && normalized.length <= MAX_QUERY_LENGTH ? normalized : null;
}

function optionalBias(url: URL, ring: LngLat[]) {
  const rawLng = url.searchParams.get("lng");
  const rawLat = url.searchParams.get("lat");
  if (rawLng !== null && rawLat !== null) {
    const candidate: LngLat = [Number(rawLng), Number(rawLat)];
    if (isLngLat(candidate) && pickupSearchPointInPolygon(candidate, ring)) return candidate;
  }
  const bounds = polygonBounds(ring);
  return [
    (bounds.minLng + bounds.maxLng) / 2,
    (bounds.minLat + bounds.maxLat) / 2,
  ] satisfies LngLat;
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function safeSourceValue(value: unknown) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized.length >= 1 && normalized.length <= 240 ? normalized : null;
}

function resultPosition(result: GeoapifyResult): LngLat | null {
  const position: LngLat = [Number(result.lon), Number(result.lat)];
  return isLngLat(position) ? position : null;
}

function normalizeGeoapifyResult(
  result: GeoapifyResult,
  index: number,
  ring: LngLat[],
): PickupAddressSearchResult | null {
  const position = resultPosition(result);
  if (!position || !pickupSearchPointInPolygon(position, ring)) return null;
  const address = safeText(result.formatted, 320);
  if (!address) return null;
  const preferredTitle =
    safeText(result.address_line1, 160) ??
    safeText(result.name, 160) ??
    safeText(address.split(",")[0], 160);
  if (!preferredTitle) return null;

  const source: Extract<PickupSource, { kind: "osm-address" }> = {
    kind: "osm-address",
    provider: "geoapify",
    placeId: safeSourceValue(result.place_id),
    osmType: safeSourceValue(result.osm_type),
    osmId: safeSourceValue(result.osm_id),
  };
  const stablePart = source.placeId ?? `${position[0]}:${position[1]}:${index}`;
  return {
    id: `geoapify:${stablePart}`,
    title: preferredTitle,
    address,
    position,
    source,
  };
}

export function pickupSearchCampaignRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/collection\/pickup-search$/u,
  );
  if (!match) return null;
  try {
    const campaignId = decodeURIComponent(match[1]);
    return ID_PATTERN.test(campaignId) ? campaignId : null;
  } catch {
    return null;
  }
}

async function resolveSearchAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
): Promise<SearchAccessResult> {
  const persistent = await resolvePersistentAccess(db, request, campaignId);
  if (persistent?.role === "admin") return { ok: true, access: persistent };
  const collection = await resolveCollectionAccess(db, request, campaignId);
  if (collection?.role === "collection-collector") return { ok: true, access: collection };
  if (persistent) {
    return {
      ok: false,
      response: errorResponse(
        403,
        "pickup_search_forbidden",
        "Nur Admins oder Collection-Helfer dürfen Pickup-Adressen suchen.",
      ),
    };
  }
  return {
    ok: false,
    response: errorResponse(401, "access_required", "Gültiger Collection-Zugriff ist erforderlich."),
  };
}

async function collectorCanCreatePickups(
  db: D1DatabaseLike,
  campaignId: string,
  collectorId: string,
) {
  const row = await db
    .prepare(
      `SELECT can_create_pickups
       FROM collection_collectors
       WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(collectorId, campaignId)
    .first<CollectorCapabilityRow>();
  return row?.can_create_pickups === 1;
}

async function loadMainAreaRing(db: D1DatabaseLike, campaignId: string) {
  const row = await db
    .prepare(
      `SELECT geometry_json
       FROM collection_main_areas
       WHERE campaign_id = ?
       LIMIT 1`,
    )
    .bind(campaignId)
    .first<MainAreaRow>();
  if (!row) return null;
  try {
    return parsePickupSearchPolygon(JSON.parse(row.geometry_json));
  } catch {
    return null;
  }
}

async function allowSearchRequest(
  limiter: RateLimitBinding,
  campaignId: string,
  access: AccessContext,
) {
  const actorRef =
    access.role === "collection-collector"
      ? access.collectorId ?? access.grantId
      : access.grantId;
  const providerLimit = await limiter.limit({ key: "pickup-search:geoapify" });
  if (!providerLimit.success) return false;
  const actorLimit = await limiter.limit({
    key: `pickup-search:${campaignId}:${actorRef}`,
  });
  return actorLimit.success;
}

async function fetchGeoapify(
  requestUrl: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(requestUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function handlePickupSearch(
  request: Request,
  env: PickupSearchEnv,
  options: {
    fetchImpl?: typeof fetch;
    upstreamUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const campaignId = pickupSearchCampaignRoute(url.pathname);
  if (!campaignId) return null;
  if (request.method !== "GET") {
    return errorResponse(405, "method_not_allowed", "Für die Pickup-Suche ist nur GET erlaubt.");
  }
  if (!env.DB) {
    return errorResponse(503, "d1_unavailable", "D1 ist für die Pickup-Suche nicht verfügbar.");
  }
  if (!(await hasPickupReadSchema(env.DB))) {
    return errorResponse(
      503,
      "pickup_schema_unavailable",
      "Pickup-Suche benötigt die vorbereitete Migration 0011.",
    );
  }

  const access = await resolveSearchAccess(env.DB, request, campaignId);
  if (!access.ok) return access.response;
  if (access.access.role === "collection-collector") {
    if (
      !access.access.collectorId ||
      !(await collectorCanCreatePickups(env.DB, campaignId, access.access.collectorId))
    ) {
      return errorResponse(
        403,
        "pickup_capability_forbidden",
        "Dieser Collection-Helfer darf keine Pickups anlegen.",
      );
    }
  }

  const query = normalizeQuery(url.searchParams.get("q"));
  if (!query) {
    return errorResponse(
      400,
      "pickup_search_query_invalid",
      "Suchtext muss zwischen 2 und 120 Zeichen lang sein.",
    );
  }
  const ring = await loadMainAreaRing(env.DB, campaignId);
  if (!ring) {
    return errorResponse(
      409,
      "collection_main_area_required",
      "Für die Pickup-Suche muss zuerst ein gültiges Collection-Hauptgebiet vorhanden sein.",
    );
  }
  if (!env.GEOAPIFY_API_KEY) {
    return errorResponse(
      503,
      "pickup_search_unconfigured",
      "Pickup-Adresssuche ist serverseitig noch nicht konfiguriert.",
    );
  }
  if (!env.PICKUP_SEARCH_LIMITER) {
    return errorResponse(
      503,
      "pickup_search_unavailable",
      "Pickup-Adresssuche ist ohne serverseitiges Rate Limit deaktiviert.",
    );
  }
  if (!(await allowSearchRequest(env.PICKUP_SEARCH_LIMITER, campaignId, access.access))) {
    return errorResponse(
      429,
      "pickup_search_rate_limited",
      "Zu viele Adresssuchen. Bitte kurz später erneut versuchen.",
    );
  }

  const bounds = polygonBounds(ring);
  const bias = optionalBias(url, ring);
  const upstream = new URL(options.upstreamUrl ?? GEOAPIFY_AUTOCOMPLETE_URL);
  upstream.searchParams.set("text", query);
  upstream.searchParams.set("format", "json");
  upstream.searchParams.set("lang", "de");
  upstream.searchParams.set("limit", String(MAX_RESULTS));
  upstream.searchParams.set(
    "filter",
    `rect:${bounds.minLng},${bounds.minLat},${bounds.maxLng},${bounds.maxLat}`,
  );
  upstream.searchParams.set("bias", `proximity:${bias[0]},${bias[1]}`);
  upstream.searchParams.set("apiKey", env.GEOAPIFY_API_KEY);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchGeoapify(
      upstream,
      options.fetchImpl ?? fetch,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return errorResponse(504, "pickup_search_timeout", "Adresssuche hat zu lange gedauert.");
    }
    return errorResponse(502, "pickup_search_upstream_failed", "Adresssuche ist derzeit nicht verfügbar.");
  }
  if (!upstreamResponse.ok) {
    return errorResponse(502, "pickup_search_upstream_failed", "Adresssuche ist derzeit nicht verfügbar.");
  }

  let payload: unknown;
  try {
    payload = await upstreamResponse.json();
  } catch {
    return errorResponse(502, "pickup_search_upstream_invalid", "Adresssuche lieferte ungültige Daten.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return errorResponse(502, "pickup_search_upstream_invalid", "Adresssuche lieferte ungültige Daten.");
  }

  const results: PickupAddressSearchResult[] = [];
  for (const [index, candidate] of payload.results.entries()) {
    if (!isRecord(candidate)) continue;
    const normalized = normalizeGeoapifyResult(candidate, index, ring);
    if (!normalized) continue;
    if (results.some((result) => result.id === normalized.id)) continue;
    results.push(normalized);
    if (results.length >= MAX_RESULTS) break;
  }

  return json({ results, attribution: PICKUP_SEARCH_ATTRIBUTION });
}

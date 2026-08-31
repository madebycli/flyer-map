export const OFFLINE_MAP_SCHEMA_VERSION = 1 as const;
export const OFFLINE_MAP_RADIUS_METERS = 3_000;

export type OfflineMapLngLat = {
  lat: number;
  lng: number;
};

export type OfflineMapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type OfflineMapLineString = {
  type: "LineString";
  coordinates: [number, number][];
};

export type OfflineMapPolygon = {
  type: "Polygon";
  coordinates: [number, number][][];
};

export type OfflineMapFeatureProperties = {
  osmType: "way";
  osmId: number;
  kind: "road" | "building";
  tags: Record<string, string>;
};

export type OfflineMapRoadFeature = {
  type: "Feature";
  id: string;
  properties: OfflineMapFeatureProperties & { kind: "road" };
  geometry: OfflineMapLineString;
};

export type OfflineMapBuildingFeature = {
  type: "Feature";
  id: string;
  properties: OfflineMapFeatureProperties & { kind: "building" };
  geometry: OfflineMapPolygon;
};

export type OfflineMapFeatureCollection<TFeature> = {
  type: "FeatureCollection";
  features: TFeature[];
};

export type OfflineMapPackage = {
  schemaVersion: typeof OFFLINE_MAP_SCHEMA_VERSION;
  sourceDataset: "OpenStreetMap";
  sourceLicense: "ODbL-1.0";
  sourceUrl: "https://www.openstreetmap.org/copyright";
  fetchedAt: string;
  sourceTimestamp: string | null;
  center: OfflineMapLngLat;
  radiusMeters: number;
  bounds: OfflineMapBounds;
  attribution: "© OpenStreetMap contributors";
  roads: OfflineMapFeatureCollection<OfflineMapRoadFeature>;
  buildings: OfflineMapFeatureCollection<OfflineMapBuildingFeature>;
};

export type OfflineMapAreaGeometry = {
  type: "Polygon";
  coordinates: [number, number][][];
};

export type OfflineMapAreaRequest = {
  center: OfflineMapLngLat;
  radiusMeters: number;
};

const SMART_MAP_MIN_RADIUS_METERS = 250;
const SMART_MAP_RADIUS_BUFFER_METERS = 50;
const EARTH_RADIUS_METERS = 6_371_000;

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: OfflineMapLngLat, b: OfflineMapLngLat) {
  const latA = degreesToRadians(a.lat);
  const latB = degreesToRadians(b.lat);
  const deltaLat = latB - latA;
  const deltaLng = degreesToRadians(b.lng - a.lng);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function areaPoints(areaGeometry: OfflineMapAreaGeometry) {
  return areaGeometry.coordinates.flat();
}

export function offlineMapPackageCoversArea(
  pkg: OfflineMapPackage,
  areaGeometry: OfflineMapAreaGeometry,
) {
  const points = areaPoints(areaGeometry);
  return points.length >= 4 && points.every(([lng, lat]) =>
    Number.isFinite(lng) &&
    Number.isFinite(lat) &&
    lng >= pkg.bounds.west &&
    lng <= pkg.bounds.east &&
    lat >= pkg.bounds.south &&
    lat <= pkg.bounds.north
  );
}

export function offlineMapRequestForArea(
  areaGeometry: OfflineMapAreaGeometry,
): OfflineMapAreaRequest | null {
  const points = areaPoints(areaGeometry);
  if (points.length < 4 || points.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat))) {
    return null;
  }

  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const center = { lat: (south + north) / 2, lng: (west + east) / 2 };
  const corners = [
    { lat: south, lng: west },
    { lat: south, lng: east },
    { lat: north, lng: west },
    { lat: north, lng: east },
  ];
  const requiredRadius = Math.max(...corners.map((corner) => distanceMeters(center, corner)));
  if (requiredRadius > OFFLINE_MAP_RADIUS_METERS) return null;

  return {
    center,
    radiusMeters: Math.min(
      OFFLINE_MAP_RADIUS_METERS,
      Math.max(SMART_MAP_MIN_RADIUS_METERS, Math.ceil(requiredRadius + SMART_MAP_RADIUS_BUFFER_METERS)),
    ),
  };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finiteNumber(value[0]) &&
    finiteNumber(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function validTags(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(
    ([key, tagValue]) =>
      key.length > 0 &&
      key.length <= 80 &&
      typeof tagValue === "string" &&
      tagValue.length <= 240,
  );
}

function validFeatureProperties(
  value: unknown,
  kind: "road" | "building",
): value is OfflineMapFeatureProperties {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.osmType === "way" &&
    typeof record.osmId === "number" &&
    Number.isSafeInteger(record.osmId) &&
    record.osmId > 0 &&
    record.kind === kind &&
    validTags(record.tags)
  );
}

function validRoadFeature(value: unknown): value is OfflineMapRoadFeature {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const feature = value as Record<string, unknown>;
  if (feature.type !== "Feature" || typeof feature.id !== "string") return false;
  if (!validFeatureProperties(feature.properties, "road")) return false;
  if (!feature.geometry || typeof feature.geometry !== "object" || Array.isArray(feature.geometry)) {
    return false;
  }
  const geometry = feature.geometry as Record<string, unknown>;
  return (
    geometry.type === "LineString" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(validCoordinate)
  );
}

function validBuildingFeature(value: unknown): value is OfflineMapBuildingFeature {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const feature = value as Record<string, unknown>;
  if (feature.type !== "Feature" || typeof feature.id !== "string") return false;
  if (!validFeatureProperties(feature.properties, "building")) return false;
  if (!feature.geometry || typeof feature.geometry !== "object" || Array.isArray(feature.geometry)) {
    return false;
  }
  const geometry = feature.geometry as Record<string, unknown>;
  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) return false;
  if (geometry.coordinates.length !== 1) return false;
  const ring = geometry.coordinates[0];
  return (
    Array.isArray(ring) &&
    ring.length >= 4 &&
    ring.every(validCoordinate) &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
  );
}

function validCollection(value: unknown, featureValidator: (feature: unknown) => boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const collection = value as Record<string, unknown>;
  return (
    collection.type === "FeatureCollection" &&
    Array.isArray(collection.features) &&
    collection.features.every(featureValidator)
  );
}

export function isOfflineMapPackage(value: unknown): value is OfflineMapPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pkg = value as Record<string, unknown>;

  const center = pkg.center as Record<string, unknown> | null;
  const bounds = pkg.bounds as Record<string, unknown> | null;
  if (!center || typeof center !== "object" || Array.isArray(center)) return false;
  if (!bounds || typeof bounds !== "object" || Array.isArray(bounds)) return false;

  return (
    pkg.schemaVersion === OFFLINE_MAP_SCHEMA_VERSION &&
    pkg.sourceDataset === "OpenStreetMap" &&
    pkg.sourceLicense === "ODbL-1.0" &&
    pkg.sourceUrl === "https://www.openstreetmap.org/copyright" &&
    typeof pkg.fetchedAt === "string" &&
    !Number.isNaN(Date.parse(pkg.fetchedAt)) &&
    (pkg.sourceTimestamp === null ||
      (typeof pkg.sourceTimestamp === "string" && !Number.isNaN(Date.parse(pkg.sourceTimestamp)))) &&
    finiteNumber(center.lat) &&
    center.lat >= -90 &&
    center.lat <= 90 &&
    finiteNumber(center.lng) &&
    center.lng >= -180 &&
    center.lng <= 180 &&
    finiteNumber(pkg.radiusMeters) &&
    pkg.radiusMeters > 0 &&
    pkg.radiusMeters <= OFFLINE_MAP_RADIUS_METERS &&
    finiteNumber(bounds.south) &&
    finiteNumber(bounds.west) &&
    finiteNumber(bounds.north) &&
    finiteNumber(bounds.east) &&
    bounds.south >= -90 &&
    bounds.north <= 90 &&
    bounds.west >= -180 &&
    bounds.east <= 180 &&
    bounds.south <= bounds.north &&
    pkg.attribution === "© OpenStreetMap contributors" &&
    validCollection(pkg.roads, validRoadFeature) &&
    validCollection(pkg.buildings, validBuildingFeature)
  );
}

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

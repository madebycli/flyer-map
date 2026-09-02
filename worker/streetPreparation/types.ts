import type {
  LineStringGeometry,
  LngLat,
  PolygonGeometry,
} from "../../src/domain/campaign.ts";

export type StreetMultiLineStringGeometry = {
  type: "MultiLineString";
  coordinates: LngLat[][];
};

export type StreetGeometryCollection = {
  type: "GeometryCollection";
  geometries: StreetInputGeometry[];
};

export type StreetInputGeometry =
  | LineStringGeometry
  | StreetMultiLineStringGeometry
  | StreetGeometryCollection;

export type StreetPreparationRoad = {
  properties: {
    osmId: number;
    tags: Record<string, string>;
  };
  geometry: StreetInputGeometry;
};

export type PreparedStreetCandidate = {
  sourceOsmWayId: number;
  sourceKey: string;
  fragmentKey: string;
  label: string;
  geometry: LineStringGeometry;
};

export type StreetPreparationSourceMetrics = {
  requestCount: number;
  tileCount: number;
  maxConcurrentRequests: number;
  upstreamBytes: number;
  parsedElementCount: number;
  normalizedRoadCount: number;
  normalizedBuildingCount: number;
  packageBytes: number;
  roadRequestCount: number;
  buildingRequestCount: number;
  roadUpstreamBytes: number;
  buildingUpstreamBytes: number;
  roadParsedElementCount: number;
  buildingParsedElementCount: number;
  roadNormalizationRejectedCount: number;
  buildingNormalizationRejectedCount: number;
};

export type StreetPreparationDiagnostics = {
  algorithmVersion: string;
  inputRoadCount: number;
  eligibleRoadCount: number;
  rejectedRoadCount: number;
  invalidRoadCount: number;
  topologyFailureCount: number;
  fragmentCount: number;
  duplicateFragmentCount: number;
  durationMs: number;
  source: StreetPreparationSourceMetrics;
};

export type StreetPreparationResult = {
  candidates: PreparedStreetCandidate[];
  diagnostics: StreetPreparationDiagnostics;
};

export type StreetPreparationInput = {
  campaignId: string;
  areaId: string;
  area: PolygonGeometry;
  generation: string;
  roads: StreetPreparationRoad[];
  timestamp: string;
  maxRoadFragments: number;
};

export type StreetFragment = PreparedStreetCandidate;

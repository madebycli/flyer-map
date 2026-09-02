import type {
  DistributionTask,
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

export type StreetPreparationDiagnostics = {
  algorithmVersion: string;
  inputRoadCount: number;
  eligibleRoadCount: number;
  rejectedRoadCount: number;
  invalidRoadCount: number;
  fragmentCount: number;
  duplicateFragmentCount: number;
  durationMs: number;
};

export type StreetPreparationResult = {
  tasks: DistributionTask[];
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

export type StreetFragment = {
  osmId: number;
  tags: Record<string, string>;
  geometry: LineStringGeometry;
  fragmentKey: string;
};

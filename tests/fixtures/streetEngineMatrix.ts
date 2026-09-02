import type { LngLat, PolygonGeometry } from "../../../src/domain/campaign.ts";
import type { StreetPreparationRoad } from "../../../worker/streetPreparation/types.ts";

export const streetEngineMatrixArea: PolygonGeometry = {
  type: "Polygon",
  coordinates: [[
    [0, 0],
    [10, 0],
    [10, 10],
    [6, 10],
    [6, 4],
    [4, 4],
    [4, 10],
    [0, 10],
    [0, 0],
  ]],
};

function line(coordinates: LngLat[]) {
  return { type: "LineString" as const, coordinates };
}

export const streetEngineMatrixRoads: StreetPreparationRoad[] = [
  {
    properties: { osmId: 100, tags: { highway: "residential", name: "Innenhofstraße" } },
    geometry: line([[1, 1], [9, 1]]),
  },
  {
    properties: { osmId: 101, tags: { highway: "residential", name: "U-Straße" } },
    geometry: line([[-1, 7], [11, 7]]),
  },
  {
    properties: { osmId: 101, tags: { highway: "residential", name: "U-Straße" } },
    geometry: line([[11, 7], [-1, 7]]),
  },
  {
    properties: { osmId: 102, tags: { highway: "footway", name: "Kurzer Weg" } },
    geometry: line([[1, 2], [2, 2.5], [3, 2.75], [4, 3]]),
  },
  {
    properties: { osmId: 103, tags: { highway: "cycleway", name: "Radweg" } },
    geometry: line([[7, 5], [8, 6], [9, 7]]),
  },
  {
    properties: { osmId: 104, tags: { highway: "service", access: "private" } },
    geometry: line([[1, 3], [9, 3]]),
  },
  {
    properties: { osmId: 105, tags: { highway: "motorway", name: "Autobahn" } },
    geometry: line([[-1, 5], [11, 5]]),
  },
  {
    properties: { osmId: 106, tags: { highway: "construction" } },
    geometry: line([[1, 6], [9, 6]]),
  },
  {
    properties: { osmId: 107, tags: { highway: "residential", name: "Ungültig" } },
    geometry: line([[2, 3], [2, 3]]),
  },
  {
    properties: { osmId: 108, tags: { highway: "path", name: "Mehrteiliger Pfad" } },
    geometry: {
      type: "MultiLineString",
      coordinates: [
        [[1, 8], [2, 8]],
        [[8, 8], [9, 8]],
      ],
    },
  },
  {
    properties: { osmId: 109, tags: { highway: "residential", name: "Collectionweg" } },
    geometry: {
      type: "GeometryCollection",
      geometries: [
        line([[-1, 2], [3, 2]]),
        line([[7, 2], [11, 2]]),
      ],
    },
  },
];

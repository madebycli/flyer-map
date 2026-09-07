import assert from "node:assert/strict";
import test from "node:test";
import type { Area } from "../src/domain/campaign.ts";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";
import {
  buildingCandidatesForArea,
  lineStringIntersectsPolygon,
  pointInPolygon,
  polygonsIntersect,
  roadCandidatesForArea,
  segmentsIntersect,
} from "../src/domain/smartGeometry.ts";

const area: Area = {
  id: "area_smart",
  campaignId: "campaign_smart",
  teamId: "team_smart",
  name: "Smart Area",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
};

function packageFixture(): OfflineMapPackage {
  return {
    schemaVersion: 1,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: "2026-08-25T10:00:00.000Z",
    sourceTimestamp: null,
    center: { lat: 5, lng: 5 },
    radiusMeters: 3_000,
    bounds: { south: -20, west: -20, north: 20, east: 20 },
    attribution: "© OpenStreetMap contributors",
    roads: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/crossing",
          properties: {
            osmType: "way",
            osmId: 1,
            kind: "road",
            tags: { highway: "residential" },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [-5, 5],
              [15, 5],
            ],
          },
        },
        {
          type: "Feature",
          id: "way/inside",
          properties: {
            osmType: "way",
            osmId: 2,
            kind: "road",
            tags: { highway: "service" },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [2, 2],
              [8, 8],
            ],
          },
        },
        {
          type: "Feature",
          id: "way/outside",
          properties: {
            osmType: "way",
            osmId: 3,
            kind: "road",
            tags: { highway: "residential" },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [12, 12],
              [15, 15],
            ],
          },
        },
      ],
    },
    buildings: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/building-inside",
          properties: {
            osmType: "way",
            osmId: 10,
            kind: "building",
            tags: { building: "yes" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [2, 2],
                [4, 2],
                [4, 4],
                [2, 4],
                [2, 2],
              ],
            ],
          },
        },
        {
          type: "Feature",
          id: "way/building-edge",
          properties: {
            osmType: "way",
            osmId: 11,
            kind: "building",
            tags: { building: "house" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [9, 9],
                [12, 9],
                [12, 12],
                [9, 12],
                [9, 9],
              ],
            ],
          },
        },
        {
          type: "Feature",
          id: "way/building-outside",
          properties: {
            osmType: "way",
            osmId: 12,
            kind: "building",
            tags: { building: "yes" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [12, 1],
                [14, 1],
                [14, 3],
                [12, 3],
                [12, 1],
              ],
            ],
          },
        },
      ],
    },
  };
}

test("point in polygon treats boundary points as included", () => {
  const ring = area.geometry.coordinates[0];
  assert.equal(pointInPolygon([5, 5], ring), true);
  assert.equal(pointInPolygon([0, 5], ring), true);
  assert.equal(pointInPolygon([11, 5], ring), false);
});

test("segment intersection includes crossing and touching boundaries", () => {
  assert.equal(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [10, 0], [10, 0], [15, 0]), true);
  assert.equal(segmentsIntersect([0, 0], [2, 0], [3, 0], [5, 0]), false);
});

test("road crossing an area is included even when both road vertices are outside", () => {
  const ring = area.geometry.coordinates[0];
  assert.equal(lineStringIntersectsPolygon([[-5, 5], [15, 5]], ring), true);
  assert.equal(lineStringIntersectsPolygon([[12, 12], [15, 15]], ring), false);
});

test("polygon intersection handles contained and edge-crossing buildings", () => {
  const ring = area.geometry.coordinates[0];
  assert.equal(
    polygonsIntersect(
      [
        [2, 2],
        [4, 2],
        [4, 4],
        [2, 4],
        [2, 2],
      ],
      ring,
    ),
    true,
  );
  assert.equal(
    polygonsIntersect(
      [
        [9, 9],
        [12, 9],
        [12, 12],
        [9, 12],
        [9, 9],
      ],
      ring,
    ),
    true,
  );
});

test("candidate extraction preserves accepted OSM way identity without inventing task ids", () => {
  const pkg = packageFixture();
  assert.deepEqual(
    roadCandidatesForArea(area, pkg).map((feature) => feature.id),
    ["way/crossing", "way/inside"],
  );
  assert.deepEqual(
    buildingCandidatesForArea(area, pkg).map((feature) => feature.id),
    ["way/building-inside", "way/building-edge"],
  );
});

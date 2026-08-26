import assert from "node:assert/strict";
import test from "node:test";
import type { Area } from "../src/domain/campaign.ts";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";
import { smartCandidatesForArea } from "../src/domain/smartCandidates.ts";

const area: Area = {
  id: "area_candidates",
  campaignId: "campaign_candidates",
  teamId: "team_candidates",
  name: "Gebiet",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [10, 50],
        [10.2, 50],
        [10.2, 50.2],
        [10, 50.2],
        [10, 50],
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
    center: { lat: 50.1, lng: 10.1 },
    radiusMeters: 3_000,
    bounds: { south: 49.9, west: 9.9, north: 50.3, east: 10.3 },
    attribution: "© OpenStreetMap contributors",
    roads: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/101",
          properties: {
            osmType: "way",
            osmId: 101,
            kind: "road",
            tags: { highway: "residential", name: "Hauptstraße", ref: "K 1" },
          },
          geometry: { type: "LineString", coordinates: [[9.9, 50.1], [10.3, 50.1]] },
        },
        {
          type: "Feature",
          id: "way/102",
          properties: {
            osmType: "way",
            osmId: 102,
            kind: "road",
            tags: { highway: "service" },
          },
          geometry: { type: "LineString", coordinates: [[10.05, 50.05], [10.08, 50.08]] },
        },
      ],
    },
    buildings: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/201",
          properties: {
            osmType: "way",
            osmId: 201,
            kind: "building",
            tags: {
              building: "house",
              "addr:housenumber": "12a",
              "addr:street": "Hauptstraße",
              "addr:postcode": "12345",
              "addr:city": "Beispielstadt",
            },
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[10.05, 50.05], [10.06, 50.05], [10.06, 50.06], [10.05, 50.05]]],
          },
        },
        {
          type: "Feature",
          id: "way/202",
          properties: {
            osmType: "way",
            osmId: 202,
            kind: "building",
            tags: { building: "yes" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [[[10.1, 50.1], [10.11, 50.1], [10.11, 50.11], [10.1, 50.1]]],
          },
        },
      ],
    },
  };
}

test("M6 candidate preparation preserves OSM source identity and useful road metadata", () => {
  const result = smartCandidatesForArea(area, packageFixture());
  assert.deepEqual(result.roads[0], {
    sourceId: "way/101",
    osmId: 101,
    name: "Hauptstraße",
    ref: "K 1",
    highway: "residential",
    geometry: { type: "LineString", coordinates: [[9.9, 50.1], [10.3, 50.1]] },
  });
  assert.equal(result.roads[1].name, null);
});

test("M6 building candidates expose address fields without inventing house-task identity", () => {
  const result = smartCandidatesForArea(area, packageFixture());
  assert.deepEqual(result.buildings[0], {
    sourceId: "way/201",
    osmId: 201,
    buildingType: "house",
    houseNumber: "12a",
    street: "Hauptstraße",
    postcode: "12345",
    city: "Beispielstadt",
    geometry: {
      type: "Polygon",
      coordinates: [[[10.05, 50.05], [10.06, 50.05], [10.06, 50.06], [10.05, 50.05]]],
    },
  });
  assert.equal(result.buildings[1].houseNumber, null);
});

test("candidate summary distinguishes named roads and addressed buildings", () => {
  assert.deepEqual(smartCandidatesForArea(area, packageFixture()).summary, {
    roadCount: 2,
    namedRoadCount: 1,
    buildingCount: 2,
    addressedBuildingCount: 1,
  });
});

test("code-like OSM names remain plain candidate text", () => {
  const pkg = packageFixture();
  pkg.roads.features[0].properties.tags.name = "<script>alert(1)</script>";
  const result = smartCandidatesForArea(area, pkg);
  assert.equal(result.roads[0].name, "<script>alert(1)</script>");
});

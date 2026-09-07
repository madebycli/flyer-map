import assert from "node:assert/strict";
import test from "node:test";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";
import {
  emptyOfflineBuildings,
  emptyOfflineRoads,
  offlineBuildingData,
  offlineMapRendererMode,
  offlineRoadData,
} from "../src/map/offlineMapContext.ts";

function packageFixture(): OfflineMapPackage {
  return {
    schemaVersion: 1,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: "2026-08-25T21:00:00.000Z",
    sourceTimestamp: "2026-08-25T20:59:00.000Z",
    center: { lat: 52.52, lng: 13.405 },
    radiusMeters: 3_000,
    bounds: { south: 52.49, west: 13.36, north: 52.55, east: 13.45 },
    attribution: "© OpenStreetMap contributors",
    roads: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "way/10",
          properties: {
            osmType: "way",
            osmId: 10,
            kind: "road",
            tags: { highway: "residential", name: "Teststraße" },
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [13.4, 52.52],
              [13.41, 52.521],
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
          id: "way/20",
          properties: {
            osmType: "way",
            osmId: 20,
            kind: "building",
            tags: { building: "yes", "addr:housenumber": "12" },
          },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [13.4, 52.52],
                [13.401, 52.52],
                [13.401, 52.521],
                [13.4, 52.52],
              ],
            ],
          },
        },
      ],
    },
  };
}

test("online renderer keeps prepared OSM context hidden", () => {
  const mode = offlineMapRendererMode(true, packageFixture());
  assert.deepEqual(mode, { offlineVisibility: "none" });
});

test("offline renderer shows prepared OSM context only when a package exists", () => {
  assert.deepEqual(offlineMapRendererMode(false, packageFixture()), {
    offlineVisibility: "visible",
  });
  assert.deepEqual(offlineMapRendererMode(false, null), {
    offlineVisibility: "none",
  });
});

test("renderer passes normalized OSM feature identity through unchanged", () => {
  const pkg = packageFixture();
  assert.equal(offlineRoadData(pkg).features[0].id, "way/10");
  assert.equal(offlineBuildingData(pkg).features[0].id, "way/20");
  assert.equal(offlineRoadData(pkg).features[0].properties.tags.name, "Teststraße");
});

test("empty renderer collections are stable GeoJSON feature collections", () => {
  assert.deepEqual(emptyOfflineRoads(), { type: "FeatureCollection", features: [] });
  assert.deepEqual(emptyOfflineBuildings(), { type: "FeatureCollection", features: [] });
  assert.deepEqual(offlineRoadData(null), emptyOfflineRoads());
  assert.deepEqual(offlineBuildingData(null), emptyOfflineBuildings());
});

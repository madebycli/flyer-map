import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { OfflineMapPackage } from "../src/domain/offlineMap.ts";
import {
  offlineMapPackageCoversArea,
  offlineMapRequestForArea,
} from "../src/domain/offlineMap.ts";

function packageFixture(): OfflineMapPackage {
  return {
    schemaVersion: 1,
    sourceDataset: "OpenStreetMap",
    sourceLicense: "ODbL-1.0",
    sourceUrl: "https://www.openstreetmap.org/copyright",
    fetchedAt: "2026-08-31T12:00:00.000Z",
    sourceTimestamp: null,
    center: { lat: 50, lng: 8 },
    radiusMeters: 1_000,
    bounds: { south: 49.99, west: 7.99, north: 50.01, east: 8.01 },
    attribution: "© OpenStreetMap contributors",
    roads: { type: "FeatureCollection", features: [] },
    buildings: { type: "FeatureCollection", features: [] },
  };
}

const coveredArea = {
  type: "Polygon" as const,
  coordinates: [[
    [7.995, 49.995] as [number, number],
    [8.005, 49.995] as [number, number],
    [8.005, 50.005] as [number, number],
    [7.995, 49.995] as [number, number],
  ]],
};

test("coverage requires every Area polygon point inside package bounds", () => {
  assert.equal(offlineMapPackageCoversArea(packageFixture(), coveredArea), true);
  assert.equal(
    offlineMapPackageCoversArea(packageFixture(), {
      ...coveredArea,
      coordinates: [[...coveredArea.coordinates[0], [8.02, 50] as [number, number]]],
    }),
    false,
  );
});

test("Area request is centered, buffered, bounded, and rejects coverage beyond 3 km", () => {
  const request = offlineMapRequestForArea(coveredArea);
  assert.ok(request);
  assert.equal(request.center.lat, 50);
  assert.equal(request.center.lng, 8);
  assert.ok(request.radiusMeters >= 250 && request.radiusMeters <= 3_000);

  const tooLarge = offlineMapRequestForArea({
    type: "Polygon",
    coordinates: [[
      [7.9, 49.9],
      [8.1, 49.9],
      [8.1, 50.1],
      [7.9, 49.9],
    ]],
  });
  assert.equal(tooLarge, null);
});

test("normal Area flow leaves OSM fetching and offline downloads out of the browser UI", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const settings = await readFile("src/settings/SettingsSheet.tsx", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(app, /fetchAreaPreparation/u);
  assert.match(app, /startAreaPreparation/u);
  assert.doesNotMatch(app, /smartRoadMapPackage|smartHouseMapPackage|smartMapRequestRef|fetchMapDataPackage/u);
  assert.doesNotMatch(app, /browserOfflineMapRepository/u);
  assert.doesNotMatch(settings, /downloadOfflineMapPackage|browserOfflineMapRepository|offline-map-section/u);
  assert.match(store, /postCampaignMutation\(campaignId, record\.mutation\)/u);
  assert.match(store, /browserMutationQueue/u);
  assert.match(store, /writeLocalSnapshot/u);
});

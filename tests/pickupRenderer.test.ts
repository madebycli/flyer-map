import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COLLECTION_PICKUP_MARKER_LAYER_ID,
  COLLECTION_PICKUP_SELECTED_LAYER_ID,
  COLLECTION_PICKUP_SOURCE_ID,
  pickupsToGeoJson,
} from "../src/map/pickupRenderer.ts";
import type { PickupTask } from "../src/domain/pickup.ts";

function pickup(id: string, overrides: Partial<PickupTask> = {}): PickupTask {
  return {
    id,
    campaignId: "campaign_test",
    areaId: null,
    title: "Abholung",
    address: "Musterstraße 1",
    description: "Nur fachlicher Text",
    position: [8.5, 49.5],
    status: "open",
    archivedAt: null,
    assignedRunIds: [],
    assignedCollectorIds: [],
    source: null,
    createdBy: { kind: "collection-collector", ref: "collector_test" },
    updatedBy: { kind: "collection-collector", ref: "collector_test" },
    createdAt: "2026-08-31T09:00:00.000Z",
    updatedAt: "2026-08-31T09:00:00.000Z",
    ...overrides,
  };
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Pickup GeoJSON uses app identity with minimized map properties", () => {
  const geoJson = pickupsToGeoJson([
    pickup("pickup_one", { status: "needs-follow-up", source: {
      kind: "osm-address",
      provider: "geoapify",
      placeId: "secret-looking-provider-id",
      osmType: "node",
      osmId: "123",
    } }),
  ]);

  assert.equal(geoJson.type, "FeatureCollection");
  assert.equal(geoJson.features.length, 1);
  assert.deepEqual(geoJson.features[0], {
    type: "Feature",
    id: "pickup_one",
    properties: {
      pickupId: "pickup_one",
      status: "needs-follow-up",
    },
    geometry: {
      type: "Point",
      coordinates: [8.5, 49.5],
    },
  });
  const serialized = JSON.stringify(geoJson);
  assert.doesNotMatch(serialized, /Musterstraße|Nur fachlicher|collector_test|geoapify|provider-id/u);
});

test("Pickup GeoJSON excludes archived and invalid positions", () => {
  const invalid = pickup("pickup_invalid", { position: [Number.NaN, 49.5] as [number, number] });
  const archived = pickup("pickup_archived", { archivedAt: "2026-08-31T10:00:00.000Z" });
  const active = pickup("pickup_active", { position: [7.2, 50.1], status: "collected" });
  const geoJson = pickupsToGeoJson([invalid, archived, active]);
  assert.deepEqual(geoJson.features.map((feature) => feature.id), ["pickup_active"]);
});

test("Pickup conversion stays one bounded GeoJSON source for dense snapshots", () => {
  const pickups = Array.from({ length: 5_000 }, (_, index) =>
    pickup(`pickup_${index}`, { position: [8 + index / 100_000, 49.5] }),
  );
  const geoJson = pickupsToGeoJson(pickups);
  assert.equal(geoJson.features.length, 5_000);
  assert.equal(new Set(geoJson.features.map((feature) => feature.id)).size, 5_000);
});

test("MapView uses fixed pickup source/layers with separate data and selection updates", () => {
  const mapView = source("../src/map/MapView.tsx");
  assert.match(mapView, /COLLECTION_PICKUP_SOURCE_ID/u);
  assert.match(mapView, /COLLECTION_PICKUP_MARKER_LAYER_ID/u);
  assert.match(mapView, /COLLECTION_PICKUP_SELECTED_LAYER_ID/u);
  assert.match(mapView, /syncCollectionPickupData/u);
  assert.match(mapView, /syncCollectionPickupSelection/u);
  assert.match(mapView, /pickupSource\.setData\(pickupsToGeoJson\(pickups\)\)/u);
  assert.match(mapView, /\[event\.point\.x - 12, event\.point\.y - 12\]/u);
  assert.match(mapView, /feature\.properties\?\.pickupId/u);
  assert.doesNotMatch(mapView, /new Marker\(/u);

  assert.equal(COLLECTION_PICKUP_SOURCE_ID, "vf-collection-pickups");
  assert.equal(COLLECTION_PICKUP_MARKER_LAYER_ID, "vf-collection-pickups-marker");
  assert.equal(COLLECTION_PICKUP_SELECTED_LAYER_ID, "vf-collection-pickups-selected");
});

test("Collector map renders only capability-visible pickups and keeps selection app-owned", () => {
  const collector = source("../src/collection/CollectionCollectorView.tsx");
  assert.match(collector, /pickupCapabilities\.canViewPickups \? collection\.pickups : \[\]/u);
  assert.match(collector, /collectionPickups=\{visiblePickups\}/u);
  assert.match(collector, /selectedCollectionPickupId=\{selectedPickupId\}/u);
  assert.match(collector, /onCollectionPickupSelect=\{setSelectedPickupId\}/u);
  assert.match(collector, /setSelectedPickupId\(pickup\.id\)/u);
});

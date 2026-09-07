import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("Pickup composer uses race-safe bounded search with map-center and one-shot location bias", () => {
  const panel = source("../src/collection/PickupPanel.tsx");
  assert.match(panel, /new AbortController\(\)/u);
  assert.match(panel, /searchSequence/u);
  assert.match(panel, /setTimeout\(\(\) => \{/u);
  assert.ok(panel.includes("}, 320)"));
  assert.match(panel, /locationBias \?\? mapCenter/u);
  assert.match(panel, /navigator\.geolocation\.getCurrentPosition/u);
  assert.doesNotMatch(panel, /watchPosition/u);
  assert.match(panel, /formatDistance\(result\.distanceMeters/u);
});

test("Pickup composer focuses MapLibre and uses map-center correction without a permanent pickup renderer", () => {
  const collector = source("../src/collection/CollectionCollectorView.tsx");
  assert.match(collector, /MapCameraCommand/u);
  assert.match(collector, /zoom: Math\.max\(currentCamera\?\.zoom \?\? 0, 17\)/u);
  assert.match(collector, /persist: false/u);
  assert.match(collector, /setPickupPosition\(camera\.center\)/u);
  assert.match(collector, /setPickupSource\(null\)/u);
  assert.match(collector, /collection-pickup-map-pin/u);
  assert.doesNotMatch(collector, /pickupSourceId|pickupLayerId|pickup-layer/u);
});

test("Pickup composer is capability-gated and persists through the existing snapshot-to-M5 path", () => {
  const collector = source("../src/collection/CollectionCollectorView.tsx");
  assert.match(collector, /collectionPickupCapabilitiesFromUnknown/u);
  assert.match(collector, /pickupCapabilities\.canViewPickups/u);
  assert.match(collector, /pickupCapabilities\.canCreatePickups/u);
  assert.match(collector, /pickupCapabilities\.canEditPickups/u);
  assert.match(collector, /createCollectionId\("pickup"\)/u);
  assert.match(collector, /updateCollection\(onSnapshotChange/u);

  const mutationDiff = source("../src/domain/mutationDiff.ts");
  assert.match(mutationDiff, /derivePickupMutation\(previous, next\) \?\? deriveBaseCampaignMutation/u);
  const queue = source("../src/data/mutationQueue.ts");
  assert.match(queue, /DurableCampaignMutation/u);
});

test("Pickup search client never contains provider credentials", () => {
  const client = source("../src/data/pickupSearchApi.ts");
  assert.doesNotMatch(client, /GEOAPIFY_API_KEY|apiKey=/u);
  assert.match(client, /credentials: "same-origin"/u);
  assert.match(client, /AbortSignal/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Pickup lifecycle UI edits content and position and soft-archives instead of deleting", () => {
  const lifecycle = source("src/collection/PickupLifecyclePanel.tsx");
  const diff = source("src/domain/pickupMutationDiff.ts");

  assert.match(lifecycle, /validatePickupDraft/u);
  assert.match(lifecycle, /Sonderadresse bearbeiten/u);
  assert.match(lifecycle, /Position auf Karte korrigieren/u);
  assert.match(lifecycle, /onEdit\(editPickup\.id/u);
  assert.match(lifecycle, /onArchive\(item\.id\)/u);
  assert.match(lifecycle, /Archivierte anzeigen/u);
  assert.match(lifecycle, /targetType="pickup-task"/u);
  assert.match(diff, /collection\.pickup\.update/u);
  assert.match(diff, /collection\.pickup\.archive/u);
  assert.match(diff, /Pickups werden archiviert und nicht hart gelöscht/u);
});

test("Collector lifecycle remains capability-gated and persists actor provenance", () => {
  const collector = source("src/collection/CollectionCollectorView.tsx");

  assert.match(collector, /PickupLifecyclePanel/u);
  assert.match(collector, /canEdit=\{pickupCapabilities\.canEditPickups\}/u);
  assert.match(collector, /const changePickupDetails/u);
  assert.match(collector, /const archivePickup/u);
  assert.match(collector, /!pickupCapabilities\.canEditPickups/u);
  assert.match(collector, /archivedAt: now, updatedBy: actor, updatedAt: now/u);
  assert.match(collector, /updatedBy: actor/u);
  assert.match(collector, /updateCollection\(onSnapshotChange/u);
  assert.doesNotMatch(collector, /fetch\([^)]*pickup/iu);
});

test("Admin has the full real pickup product path on the existing map and snapshot runtime", () => {
  const admin = source("src/collection/CollectionAdminPanel.tsx");
  const workspace = source("src/collection/CollectionAdminPickupWorkspace.tsx");

  assert.match(admin, /CollectionAdminPickupWorkspace/u);
  assert.match(workspace, /<MapView/u);
  assert.match(workspace, /<PickupPanel/u);
  assert.match(workspace, /<PickupLifecyclePanel/u);
  assert.match(workspace, /canCreate/u);
  assert.match(workspace, /canEdit/u);
  assert.match(workspace, /collectionPickups=\{collection\.pickups\}/u);
  assert.match(workspace, /createCollectionId\("pickup"\)/u);
  assert.match(workspace, /onSnapshotChange/u);
  assert.match(workspace, /archivedAt: now/u);
  assert.match(workspace, /manualRefreshCampaign/u);
  assert.doesNotMatch(workspace, /new Map\(|mapboxgl\.Marker|new Marker/u);
});

test("Archived pickup markers stay out of the permanent MapLibre renderer while records remain reviewable", () => {
  const renderer = source("src/map/pickupRenderer.ts");
  const lifecycle = source("src/collection/PickupLifecyclePanel.tsx");

  assert.match(renderer, /pickup\.archivedAt === null/u);
  assert.match(lifecycle, /items\.filter\(\(item\) => item\.archivedAt !== null\)/u);
  assert.match(lifecycle, /Kommentare prüfen/u);
});

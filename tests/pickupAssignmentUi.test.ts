import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Pickup assignment stays on the existing PickupPanel and M5 mutation path", () => {
  const panel = source("src/collection/PickupPanel.tsx");
  const diff = source("src/domain/pickupMutationDiff.ts");

  assert.match(panel, /PickupAssignmentEditor/u);
  assert.match(panel, /canAssign/u);
  assert.match(panel, /onAssignmentChange/u);
  assert.match(panel, /assignedRunIds/u);
  assert.match(panel, /assignedCollectorIds/u);
  assert.match(diff, /collection\.pickup\.set-assignment/u);
  assert.doesNotMatch(panel, /\/api\/.*assignment/iu);
});

test("Collector assignment capability is independent from Pickup edit and create", () => {
  const collector = source("src/collection/CollectionCollectorView.tsx");

  assert.match(collector, /canAssign=\{pickupCapabilities\.canAssignPickups\}/u);
  assert.match(collector, /onAssignmentChange=\{changePickupAssignment\}/u);
  assert.match(collector, /!pickupCapabilities\.canAssignPickups/u);
  assert.match(collector, /assignedRunIds: \[\.\.\.assignedRunIds\]/u);
  assert.match(collector, /assignedCollectorIds: \[\.\.\.assignedCollectorIds\]/u);
  assert.match(collector, /updatedBy: actor/u);
});

test("Admin and Collector reuse one assignment editor with active options", () => {
  const admin = source("src/collection/CollectionAdminPanel.tsx");
  const collector = source("src/collection/CollectionCollectorView.tsx");
  const editor = source("src/collection/PickupAssignmentEditor.tsx");

  assert.match(admin, /PickupAssignmentEditor/u);
  assert.match(admin, /run\.status === "active"/u);
  assert.match(admin, /!collector\.revokedAt/u);
  assert.match(collector, /run\.status === "active"/u);
  assert.match(editor, /Zuweisung speichern/u);
  assert.match(editor, /no longer active/u);
  assert.match(editor, /onSave\(orderedRuns, orderedCollectors\)/u);
});

test("Worker rejects inactive Run and revoked Collector assignment references", () => {
  const worker = source("worker/pickupMutationRuntime.ts");

  assert.match(worker, /table === "collection_runs"\s*\? " AND status = 'active'"/u);
  assert.match(worker, /" AND revoked_at IS NULL"/u);
  assert.match(worker, /pickup_assignment_invalid/u);
});

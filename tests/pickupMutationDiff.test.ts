import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { PickupTask } from "../src/domain/pickup.ts";
import {
  deriveCampaignMutation,
  MutationDerivationError,
} from "../src/domain/mutationDiff.ts";

const stamp = "2026-08-30T13:00:00.000Z";

function pickup(overrides: Partial<PickupTask> = {}): PickupTask {
  return {
    id: "collection_pickup_diff",
    campaignId: "campaign_pickup_diff",
    areaId: null,
    title: "Abholung",
    address: "Hauptstraße 1",
    description: "",
    position: [10, 50],
    status: "open",
    archivedAt: null,
    assignedRunIds: [],
    assignedCollectorIds: [],
    source: null,
    createdBy: { kind: "campaign-grant", ref: "grant_admin" },
    updatedBy: { kind: "campaign-grant", ref: "grant_admin" },
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function snapshot(revision: number, pickups: PickupTask[]): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision,
    campaign: {
      id: "campaign_pickup_diff",
      name: "Pickup Diff",
      status: "active",
      defaultMapView: null,
      createdAt: stamp,
      updatedAt: revision === 0 ? stamp : `2026-08-30T13:0${revision}:00.000Z`,
    },
    teams: [],
    areas: [],
    tasks: [],
    collection: {
      mainArea: null,
      areas: [],
      runs: [],
      pickups,
    },
  };
}

test("Pickup create derives one durable collection.pickup.create mutation", () => {
  const previous = snapshot(0, []);
  const next = snapshot(1, [pickup()]);
  const mutation = deriveCampaignMutation(previous, next);
  assert.ok(mutation);
  assert.equal(mutation.type, "collection.pickup.create");
  if (mutation.type !== "collection.pickup.create") throw new Error("unexpected mutation");
  assert.deepEqual(mutation.payload, {
    pickupId: "collection_pickup_diff",
    areaId: null,
    title: "Abholung",
    address: "Hauptstraße 1",
    description: "",
    position: [10, 50],
    source: null,
  });
  assert.equal(mutation.baseRevision, 0);
});

test("Pickup content, status, assignment and archive each derive a narrow mutation", () => {
  const old = pickup();

  const contentAt = "2026-08-30T13:05:00.000Z";
  const contentMutation = deriveCampaignMutation(
    snapshot(0, [old]),
    snapshot(1, [pickup({
      title: "Neue Abholung",
      address: "Nebenstraße 2",
      position: [10.1, 50.1],
      updatedAt: contentAt,
    })]),
  );
  assert.equal(contentMutation?.type, "collection.pickup.update");
  if (contentMutation?.type !== "collection.pickup.update") throw new Error("unexpected content mutation");
  assert.equal(contentMutation.payload.expectedUpdatedAt, stamp);

  const statusAt = "2026-08-30T13:06:00.000Z";
  const statusMutation = deriveCampaignMutation(
    snapshot(0, [old]),
    snapshot(1, [pickup({ status: "collected", updatedAt: statusAt })]),
  );
  assert.equal(statusMutation?.type, "collection.pickup.set-status");

  const assignmentAt = "2026-08-30T13:07:00.000Z";
  const assignmentMutation = deriveCampaignMutation(
    snapshot(0, [old]),
    snapshot(1, [pickup({
      assignedRunIds: ["collection_run_one"],
      assignedCollectorIds: ["collector_one"],
      updatedAt: assignmentAt,
    })]),
  );
  assert.equal(assignmentMutation?.type, "collection.pickup.set-assignment");

  const archiveAt = "2026-08-30T13:08:00.000Z";
  const archiveMutation = deriveCampaignMutation(
    snapshot(0, [old]),
    snapshot(1, [pickup({ archivedAt: archiveAt, updatedAt: archiveAt })]),
  );
  assert.equal(archiveMutation?.type, "collection.pickup.archive");
});

test("Pickup hard delete and mixed-domain writes are rejected before queueing", () => {
  assert.throws(
    () => deriveCampaignMutation(snapshot(0, [pickup()]), snapshot(1, [])),
    MutationDerivationError,
  );

  const previous = snapshot(0, [pickup()]);
  const next = snapshot(1, [pickup({ status: "collected", updatedAt: "2026-08-30T13:09:00.000Z" })]);
  next.campaign.name = "Mixed change";
  assert.throws(
    () => deriveCampaignMutation(previous, next),
    /Pickup und andere Domain-Daten/u,
  );
});

test("Pickup mutation dispatcher preserves the previous mutation engine unchanged behind a wrapper", () => {
  const wrapper = readFileSync(new URL("../src/domain/mutationDiff.ts", import.meta.url), "utf8");
  assert.match(wrapper, /derivePickupMutation\(previous, next\) \?\? deriveBaseCampaignMutation/u);
  const queueWrapper = readFileSync(new URL("../src/data/mutationQueue.ts", import.meta.url), "utf8");
  assert.match(queueWrapper, /DurableCampaignMutation/u);
  assert.match(queueWrapper, /mutationQueueBase\.ts/u);
});

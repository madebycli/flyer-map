import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createCollectionId,
  type CollectionSnapshot,
} from "../src/domain/collection.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  applyCampaignMutation,
  createCampaignMutation,
} from "../src/domain/mutations.ts";
import { deriveCampaignMutation } from "../src/domain/mutationDiff.ts";
import { validateCampaignSnapshot } from "../worker/snapshotValidation.ts";
import { authorizeSnapshotWrite } from "../worker/authorization.ts";

const stamp = "2026-08-30T10:00:00.000Z";

function polygon(offset: number) {
  return {
    type: "Polygon" as const,
    coordinates: [[
      [10 + offset, 50],
      [10.01 + offset, 50],
      [10.01 + offset, 50.01],
      [10 + offset, 50.01],
      [10 + offset, 50],
    ]],
  };
}

function collectionFixture(): CollectionSnapshot {
  return {
    mainArea: {
      id: "collection_main_fixture",
      campaignId: "campaign_fixture",
      name: "Sammelgebiet",
      geometry: polygon(0),
      createdAt: stamp,
      updatedAt: stamp,
    },
    areas: [
      {
        id: "collection_area_one",
        campaignId: "campaign_fixture",
        mainAreaId: "collection_main_fixture",
        name: "Nord",
        geometry: polygon(0.001),
        color: "#2563eb",
        status: "open",
        runId: null,
        claimedByCollectorId: null,
        claimedByLabel: null,
        completedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "collection_area_two",
        campaignId: "campaign_fixture",
        mainAreaId: "collection_main_fixture",
        name: "Süd",
        geometry: polygon(0.02),
        color: "#16a34a",
        status: "open",
        runId: null,
        claimedByCollectorId: null,
        claimedByLabel: null,
        completedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    runs: [],
  };
}

function snapshot(collection: CollectionSnapshot = collectionFixture()): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 0,
    campaign: {
      id: "campaign_fixture",
      name: "Test",
      status: "active",
      defaultMapView: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    teams: [],
    areas: [],
    tasks: [],
    collection,
  };
}

function mutation<T extends Parameters<typeof createCampaignMutation>[1]>(
  current: CampaignSnapshot,
  draft: T,
  id: string,
  createdAt = stamp,
) {
  return createCampaignMutation(current, draft, { id, createdAt });
}

test("Collection IDs stay application-owned and collection snapshots validate", () => {
  const id = createCollectionId("area");
  assert.match(id, /^collection_area_/);
  assert.doesNotMatch(id, /^way\//);
  const result = validateCampaignSnapshot(snapshot(), "campaign_fixture");
  assert.equal(result.valid, true);
});

test("multiple open Collection Areas can be claimed in one Run and derive one mutation", () => {
  const initial = snapshot();
  const started = applyCampaignMutation(
    initial,
    mutation(initial, {
      type: "collection.run.start",
      payload: {
        runId: "collection_run_fixture",
        memberId: "collection_member_fixture",
        mainAreaId: "collection_main_fixture",
        collectorId: "collector_fixture",
        label: "Nutzer 1",
      },
    }, "mutation_collection_start"),
  );
  const claimed = applyCampaignMutation(
    started,
    mutation(started, {
      type: "collection.run.claim-areas",
      payload: {
        runId: "collection_run_fixture",
        collectorId: "collector_fixture",
        collectorLabel: "Nutzer 1",
        areaIds: ["collection_area_one", "collection_area_two"],
      },
    }, "mutation_collection_claim"),
  );
  assert.deepEqual(
    claimed.collection?.areas.map((area) => area.status),
    ["claimed", "claimed"],
  );
  assert.deepEqual(claimed.collection?.runs[0]?.areaIds, [
    "collection_area_one",
    "collection_area_two",
  ]);

  const derived = deriveCampaignMutation(started, claimed);
  assert.equal(derived?.type, "collection.run.claim-areas");
  if (derived?.type === "collection.run.claim-areas") {
    assert.deepEqual(derived.payload.areaIds, [
      "collection_area_one",
      "collection_area_two",
    ]);
  }
});

test("Collection Run supports join, start, complete, release and close", () => {
  const initial = snapshot();
  const started = applyCampaignMutation(initial, mutation(initial, {
    type: "collection.run.start",
    payload: {
      runId: "collection_run_lifecycle",
      memberId: "collection_member_one",
      mainAreaId: "collection_main_fixture",
      collectorId: "collector_one",
      label: "Nutzer 1",
    },
  }, "mutation_lifecycle_start"));
  const joined = applyCampaignMutation(started, mutation(started, {
    type: "collection.run.join",
    payload: {
      runId: "collection_run_lifecycle",
      memberId: "collection_member_two",
      collectorId: "collector_two",
      label: "Nutzer 2",
    },
  }, "mutation_lifecycle_join"));
  const claimed = applyCampaignMutation(joined, mutation(joined, {
    type: "collection.run.claim-areas",
    payload: {
      runId: "collection_run_lifecycle",
      collectorId: "collector_one",
      collectorLabel: "Nutzer 1",
      areaIds: ["collection_area_one", "collection_area_two"],
    },
  }, "mutation_lifecycle_claim"));
  const inProgress = applyCampaignMutation(claimed, mutation(claimed, {
    type: "collection.run.start-area",
    payload: {
      runId: "collection_run_lifecycle",
      collectorId: "collector_one",
      areaId: "collection_area_one",
    },
  }, "mutation_lifecycle_start_area"));
  const completed = applyCampaignMutation(inProgress, mutation(inProgress, {
    type: "collection.run.complete-area",
    payload: {
      runId: "collection_run_lifecycle",
      collectorId: "collector_one",
      areaId: "collection_area_one",
    },
  }, "mutation_lifecycle_complete_one"));
  const released = applyCampaignMutation(completed, mutation(completed, {
    type: "collection.run.release-area",
    payload: {
      runId: "collection_run_lifecycle",
      areaId: "collection_area_two",
      collectorId: "collector_one",
    },
  }, "mutation_lifecycle_release"));
  assert.equal(released.collection?.areas[0]?.status, "completed");
  assert.equal(released.collection?.areas[1]?.status, "open");
  const closed = applyCampaignMutation(released, mutation(released, {
    type: "collection.run.close",
    payload: { runId: "collection_run_lifecycle", collectorId: "collector_one" },
  }, "mutation_lifecycle_close"));
  assert.equal(closed.collection?.runs[0]?.status, "closed");
});

test("admin force release clears a claimed area without a collector actor", () => {
  const initial = snapshot();
  const started = applyCampaignMutation(initial, mutation(initial, {
    type: "collection.run.start",
    payload: {
      runId: "collection_run_admin",
      memberId: "collection_member_admin",
      mainAreaId: "collection_main_fixture",
      collectorId: "collector_fixture",
      label: "Nutzer 1",
    },
  }, "mutation_admin_start"));
  const claimed = applyCampaignMutation(started, mutation(started, {
    type: "collection.run.claim-areas",
    payload: {
      runId: "collection_run_admin",
      collectorId: "collector_fixture",
      collectorLabel: "Nutzer 1",
      areaIds: ["collection_area_one"],
    },
  }, "mutation_admin_claim"));
  const released = applyCampaignMutation(claimed, mutation(claimed, {
    type: "collection.admin.force-release-area",
    payload: {
      runId: "collection_run_admin",
      areaId: "collection_area_one",
      adminId: "admin_fixture",
    },
  }, "mutation_admin_release"));
  assert.equal(released.collection?.areas[0]?.status, "open");
  assert.equal(released.collection?.areas[0]?.runId, null);
  assert.deepEqual(released.collection?.runs[0]?.areaIds, []);
});

test("Collection collectors can write Collection only, while normal distribution stays immutable", () => {
  const previous = snapshot();
  const next = {
    ...previous,
    revision: 1,
    campaign: { ...previous.campaign, updatedAt: "2026-08-30T10:01:00.000Z" },
    collection: {
      ...previous.collection!,
      mainArea: { ...previous.collection!.mainArea!, name: "Sammelgebiet neu", updatedAt: "2026-08-30T10:01:00.000Z" },
    },
  };
  const access = {
    grantId: "collection:collector_fixture",
    campaignId: "campaign_fixture",
    role: "collection-collector" as const,
    teamId: null,
    label: "Nutzer 1",
    collectorId: "collector_fixture",
    collectionAccessId: "collection_access_fixture",
  };
  assert.deepEqual(authorizeSnapshotWrite(access, previous, next), { allowed: true });
  const forged = { ...next, tasks: [{
    id: "task_forged",
    campaignId: "campaign_fixture",
    areaId: "area_missing",
    taskType: "street" as const,
    label: "forged",
    geometry: { type: "LineString" as const, coordinates: [[10, 50], [10.01, 50]] },
    status: "open" as const,
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
  }] };
  assert.equal(authorizeSnapshotWrite(access, previous, forged).allowed, false);
});

test("production Collection flow uses the real MapLibre surface and has no preview road fixtures", () => {
  const collectorSource = readFileSync("src/collection/CollectionCollectorView.tsx", "utf8");
  const mapSource = readFileSync("src/map/MapView.tsx", "utf8");
  assert.match(collectorSource, /<MapView/);
  assert.doesNotMatch(collectorSource, /PREVIEW_ROADS|Mock Roads|mock road/i);
  assert.match(mapSource, /vf-collection-areas/);
  assert.match(mapSource, /queryRenderedFeatures/);
});

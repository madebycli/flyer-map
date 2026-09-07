import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  createInitialCampaignState,
  type D1DatabaseLike,
  type D1PreparedStatement,
  type D1RunResult,
} from "../worker/campaignRepository.ts";

class FakeStatement implements D1PreparedStatement {
  query: string;
  currentRevision: number;
  values: unknown[] = [];

  constructor(query: string, currentRevision: number) {
    this.query = query;
    this.currentRevision = currentRevision;
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("SELECT revision FROM campaigns")) {
      return { revision: this.currentRevision } as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class FakeDatabase implements D1DatabaseLike {
  claimChanges: number;
  currentRevision: number;
  lastBatch: FakeStatement[] = [];

  constructor(claimChanges: number, currentRevision: number) {
    this.claimChanges = claimChanges;
    this.currentRevision = currentRevision;
  }

  prepare(query: string) {
    return new FakeStatement(query, this.currentRevision);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.lastBatch = statements as FakeStatement[];
    return statements.map<D1RunResult>((_, index) => ({
      success: true,
      meta: { changes: index === 0 ? this.claimChanges : 0 },
    }));
  }
}

function snapshotWithManyTasks(taskCount = 120): CampaignSnapshot {
  const campaignId = "campaign_test-1";
  const createdAt = "2026-08-24T00:00:00.000Z";
  const teamId = "team_test-1";
  const areaId = "area_test-1";

  return {
    schemaVersion: 3,
    revision: 0,
    campaign: {
      id: campaignId,
      name: "Testaktion",
      status: "active",
      defaultMapView: {
        center: [9.48, 51.31],
        zoom: 11.5,
        bearing: 32,
      },
      createdAt,
      updatedAt: createdAt,
    },
    teams: [
      {
        id: teamId,
        campaignId,
        name: "Team 1",
        color: "#2563eb",
        createdAt,
        updatedAt: createdAt,
      },
    ],
    areas: [
      {
        id: areaId,
        campaignId,
        teamId,
        name: "Gebiet 1",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [8.6, 49.4],
              [8.61, 49.4],
              [8.61, 49.41],
              [8.6, 49.4],
            ],
          ],
        },
        createdAt,
        updatedAt: createdAt,
      },
    ],
    tasks: Array.from({ length: taskCount }, (_, index) => ({
      id: `task_${index}`,
      campaignId,
      areaId,
      taskType: "street" as const,
      label: `Straße ${index + 1}`,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [8.6, 49.4] as [number, number],
          [8.61, 49.41] as [number, number],
        ],
      },
      status: "open" as const,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    })),
  };
}

test("initial campaign creation uses an insert-only D1 batch", async () => {
  const db = new FakeDatabase(1, 7);
  const result = await createInitialCampaignState(db, snapshotWithManyTasks());

  assert.deepEqual(result, { ok: true, revision: 0 });
  assert.equal(db.lastBatch.length, 4);
  assert.match(db.lastBatch[0].query, /INSERT OR IGNORE INTO campaigns/u);
  assert.match(db.lastBatch[0].query, /map_center_lng/u);
  assert.match(db.lastBatch[1].query, /json_each\(\?\)/u);
  assert.match(db.lastBatch[2].query, /json_each\(\?\)/u);
  assert.match(db.lastBatch[3].query, /json_each\(\?\)/u);
  assert.doesNotMatch(
    db.lastBatch.map((statement) => statement.query).join("\n"),
    /DELETE FROM|UPDATE campaigns/u,
  );
});

test("an existing campaign is rejected without reporting a successful create", async () => {
  const db = new FakeDatabase(0, 9);
  const result = await createInitialCampaignState(db, snapshotWithManyTasks(1));

  assert.deepEqual(result, {
    ok: false,
    reason: "campaign_exists",
  });
  assert.equal(db.lastBatch.length, 4);
});

test("initial creation rejects a nonzero revision before touching D1", async () => {
  const db = new FakeDatabase(1, 7);
  const snapshot = snapshotWithManyTasks(1);
  snapshot.revision = 1;

  assert.deepEqual(await createInitialCampaignState(db, snapshot), {
    ok: false,
    reason: "initial_revision_invalid",
  });
  assert.equal(db.lastBatch.length, 0);
});

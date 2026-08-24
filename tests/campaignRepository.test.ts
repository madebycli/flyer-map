import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  replaceCampaignSnapshot,
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
    revision: 8,
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

test("snapshot replacement uses a constant seven-statement D1 batch", async () => {
  const db = new FakeDatabase(1, 7);
  const result = await replaceCampaignSnapshot(db, snapshotWithManyTasks(), 7);

  assert.deepEqual(result, { ok: true, revision: 8 });
  assert.equal(db.lastBatch.length, 7);
  assert.match(db.lastBatch[0].query, /map_center_lng/);
  assert.match(db.lastBatch[4].query, /json_each\(\?\)/);
  assert.match(db.lastBatch[5].query, /json_each\(\?\)/);
  assert.match(db.lastBatch[6].query, /json_each\(\?\)/);
});

test("a failed revision claim reports conflict instead of success", async () => {
  const db = new FakeDatabase(0, 9);
  const result = await replaceCampaignSnapshot(db, snapshotWithManyTasks(1), 7);

  assert.deepEqual(result, { ok: false, currentRevision: 9 });
  assert.equal(db.lastBatch.length, 7);
});

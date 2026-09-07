import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CollectionMutation } from "../src/domain/mutations.ts";
import {
  createCollectionAccessLink,
  redeemCollectionAccess,
  resolveCollectionAccess,
  revokeCollectionCollector,
  revokeCollectionSession,
} from "../worker/collectionAccess.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";

const migrationFiles = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0010_fc5_collection_access_areas_runs.sql",
];

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const row = this.db.prepare(this.query).get(...this.values);
    return (row ?? null) as T | null;
  }

  async all<T>() {
    return { results: this.db.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } } satisfies D1RunResult;
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly raw = new DatabaseSync(":memory:");

  prepare(query: string) {
    return new SqliteStatement(this.raw, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.raw.exec("BEGIN");
    try {
      const results = statements.map((statement) => (statement as SqliteStatement).run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

function database() {
  const db = new SqliteD1();
  for (const file of migrationFiles) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_collection', 'Collection', 'active', 0, 'initial-write-token',
             '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  return db;
}

function collectionRequest(secret: string) {
  return new Request("https://flyer.test/collection", {
    headers: { cookie: `vf_collection_session=${encodeURIComponent(secret)}` },
  });
}

test("rotating the Collection QR blocks old redemption without disconnecting an issued collector session", async () => {
  const db = database();
  const first = await createCollectionAccessLink(db, "campaign_collection");
  const redeemed = await redeemCollectionAccess(db, "campaign_collection", first.token);
  assert.ok(redeemed);

  const request = collectionRequest(redeemed.sessionSecret);
  const beforeRotation = await resolveCollectionAccess(db, request, "campaign_collection");
  assert.equal(beforeRotation?.collectorId, redeemed.access.collectorId);

  const second = await createCollectionAccessLink(db, "campaign_collection");
  assert.notEqual(second.token, first.token);
  assert.equal(await redeemCollectionAccess(db, "campaign_collection", first.token), null);

  const afterRotation = await resolveCollectionAccess(db, request, "campaign_collection");
  assert.equal(afterRotation?.collectorId, redeemed.access.collectorId);
});

test("Collection logout and explicit collector revoke invalidate issued sessions server-side", async () => {
  const db = database();
  const link = await createCollectionAccessLink(db, "campaign_collection");
  const first = await redeemCollectionAccess(db, "campaign_collection", link.token);
  assert.ok(first);

  const firstRequest = collectionRequest(first.sessionSecret);
  assert.ok(await resolveCollectionAccess(db, firstRequest, "campaign_collection"));
  await revokeCollectionSession(db, firstRequest);
  assert.equal(await resolveCollectionAccess(db, firstRequest, "campaign_collection"), null);

  const second = await redeemCollectionAccess(db, "campaign_collection", link.token);
  assert.ok(second);
  const secondRequest = collectionRequest(second.sessionSecret);
  assert.ok(await resolveCollectionAccess(db, secondRequest, "campaign_collection"));
  assert.equal(
    await revokeCollectionCollector(db, "campaign_collection", second.access.collectorId!),
    true,
  );
  assert.equal(await resolveCollectionAccess(db, secondRequest, "campaign_collection"), null);
});

test("collection.run.complete-area persists through the real SQLite schema and advances one revision", async () => {
  const db = database();
  const stamp = "2026-08-30T13:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.01, 50], [10.01, 50.01], [10, 50]]],
  });

  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_one', 'campaign_collection', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_runs
       (id, campaign_id, main_area_id, status, started_at, ended_at,
        created_by_collector_id, area_ids_json, created_at, updated_at)
     VALUES ('collection_run_one', 'campaign_collection', 'collection_main_one', 'active', ?, NULL,
             'collector_one', '["collection_area_one"]', ?, ?)`,
  ).run(stamp, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('collection_area_one', 'campaign_collection', 'collection_main_one', 'Nord', ?, '#2563eb',
             'claimed', 'collection_run_one', 'collector_one', 'Nutzer 1', NULL, ?, ?)`,
  ).run(polygon, stamp, stamp);

  const mutation: CollectionMutation = {
    id: "mutation_collection_complete_one",
    campaignId: "campaign_collection",
    type: "collection.run.complete-area",
    payload: {
      runId: "collection_run_one",
      areaId: "collection_area_one",
      collectorId: "collector_one",
    },
    baseRevision: 0,
    createdAt: "2026-08-30T13:05:00.000Z",
  };

  const result = await persistCampaignMutation(db, mutation, 0);
  assert.deepEqual(result, { ok: true, revision: 1, alreadyApplied: false });

  const area = db.raw.prepare(
    "SELECT status, completed_at FROM collection_areas WHERE id = 'collection_area_one'",
  ).get() as { status: string; completed_at: string | null };
  assert.equal(area.status, "completed");
  assert.equal(area.completed_at, mutation.createdAt);

  const claim = db.raw.prepare(
    "SELECT action, collector_id FROM collection_area_claims WHERE area_id = 'collection_area_one' ORDER BY occurred_at DESC LIMIT 1",
  ).get() as { action: string; collector_id: string | null };
  assert.equal(claim.action, "complete");
  assert.equal(claim.collector_id, "collector_one");

  const campaign = db.raw.prepare(
    "SELECT revision FROM campaigns WHERE id = 'campaign_collection'",
  ).get() as { revision: number };
  assert.equal(campaign.revision, 1);
});

test("collection.run.cancel releases unfinished areas and recomputes persisted run area ids", async () => {
  const db = database();
  const stamp = "2026-08-30T14:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.01, 50], [10.01, 50.01], [10, 50]]],
  });

  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_cancel', 'campaign_collection', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_runs
       (id, campaign_id, main_area_id, status, started_at, ended_at,
        created_by_collector_id, area_ids_json, created_at, updated_at)
     VALUES ('collection_run_cancel', 'campaign_collection', 'collection_main_cancel', 'active', ?, NULL,
             'collector_one', '["collection_area_done","collection_area_open"]', ?, ?)`,
  ).run(stamp, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES
       ('collection_area_done', 'campaign_collection', 'collection_main_cancel', 'Fertig', ?, '#2563eb',
        'completed', 'collection_run_cancel', 'collector_one', 'Nutzer 1', ?, ?, ?),
       ('collection_area_open', 'campaign_collection', 'collection_main_cancel', 'Offen', ?, '#16a34a',
        'claimed', 'collection_run_cancel', 'collector_one', 'Nutzer 1', NULL, ?, ?)`,
  ).run(polygon, stamp, stamp, stamp, polygon, stamp, stamp);

  const mutation: CollectionMutation = {
    id: "mutation_collection_cancel_one",
    campaignId: "campaign_collection",
    type: "collection.run.cancel",
    payload: { runId: "collection_run_cancel", collectorId: "collector_one" },
    baseRevision: 0,
    createdAt: "2026-08-30T14:05:00.000Z",
  };

  const result = await persistCampaignMutation(db, mutation, 0);
  assert.deepEqual(result, { ok: true, revision: 1, alreadyApplied: false });

  const run = db.raw.prepare(
    "SELECT status, area_ids_json FROM collection_runs WHERE id = 'collection_run_cancel'",
  ).get() as { status: string; area_ids_json: string };
  assert.equal(run.status, "cancelled");
  assert.deepEqual(JSON.parse(run.area_ids_json), ["collection_area_done"]);

  const released = db.raw.prepare(
    "SELECT status, run_id FROM collection_areas WHERE id = 'collection_area_open'",
  ).get() as { status: string; run_id: string | null };
  assert.equal(released.status, "open");
  assert.equal(released.run_id, null);

  const completed = db.raw.prepare(
    "SELECT status, run_id FROM collection_areas WHERE id = 'collection_area_done'",
  ).get() as { status: string; run_id: string | null };
  assert.equal(completed.status, "completed");
  assert.equal(completed.run_id, "collection_run_cancel");
});

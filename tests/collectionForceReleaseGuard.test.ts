import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";

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
  for (const file of [
    "0001_initial.sql",
    "0002_m4_access.sql",
    "0003_m5_mutations.sql",
    "0010_fc5_collection_access_areas_runs.sql",
  ]) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const stamp = "2026-08-30T15:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.01, 50], [10.01, 50.01], [10, 50]]],
  });
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_force_release', 'Collection', 'active', 0, 'write-token', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_force', 'campaign_force_release', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_runs
       (id, campaign_id, main_area_id, status, started_at, ended_at,
        created_by_collector_id, area_ids_json, created_at, updated_at)
     VALUES ('collection_run_actual', 'campaign_force_release', 'collection_main_force', 'active', ?, NULL,
             'collector_one', '["collection_area_force"]', ?, ?)`,
  ).run(stamp, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('collection_area_force', 'campaign_force_release', 'collection_main_force', 'Nord', ?, '#2563eb',
             'claimed', 'collection_run_actual', 'collector_one', 'Nutzer 1', NULL, ?, ?)`,
  ).run(polygon, stamp, stamp);
  return db;
}

const admin: AccessContext = {
  grantId: "grant_admin",
  campaignId: "campaign_force_release",
  role: "admin",
  teamId: null,
  label: "Admin",
};

test("admin force release rejects a forged run selector before claiming a revision", async () => {
  const db = database();
  const mutation = {
    id: "mutation_force_release_wrong_run",
    campaignId: "campaign_force_release",
    type: "collection.admin.force-release-area",
    payload: {
      runId: "collection_run_wrong",
      areaId: "collection_area_force",
      adminId: "admin-client-label",
    },
    baseRevision: 0,
    createdAt: "2026-08-30T15:05:00.000Z",
  };

  const response = await handleCampaignMutation(
    new Request("https://flyer.test/api/campaigns/campaign_force_release/mutations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutation }),
    }),
    db,
    "campaign_force_release",
    admin,
  );

  assert.equal(response.status, 409);
  const body = await response.json() as { error: { code: string }; revision: number };
  assert.equal(body.error.code, "mutation_conflict");
  assert.equal(body.revision, 0);

  const area = db.raw.prepare(
    "SELECT status, run_id FROM collection_areas WHERE id = 'collection_area_force'",
  ).get() as { status: string; run_id: string | null };
  assert.equal(area.status, "claimed");
  assert.equal(area.run_id, "collection_run_actual");

  const campaign = db.raw.prepare(
    "SELECT revision FROM campaigns WHERE id = 'campaign_force_release'",
  ).get() as { revision: number };
  assert.equal(campaign.revision, 0);
});

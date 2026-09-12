import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import { loadCampaignSnapshot } from "../worker/campaignRepository.ts";
import { handleRxdbPush } from "../worker/rxdbSync.ts";

const timestamp = "2026-09-02T10:00:00.000Z";
const canonicalUpdateAt = "2026-09-02T10:01:00.000Z";
const clientUpdateAt = "2026-09-02T10:02:00.000Z";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(readonly query: string, private readonly sqlite: DatabaseSync) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.sqlite.prepare(this.query).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] };
  }

  run() {
    return this.sqlite.prepare(this.query).run(...this.values);
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const file of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
      "0017_rxdb_sync_changes.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  }

  prepare(query: string) {
    return new Statement(query, this.sqlite);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as Statement[]).map<D1RunResult>((statement) => {
        const result = statement.run();
        return { success: true, meta: { changes: Number(result.changes) } };
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function seedD1(db: SqliteD1, campaignId: string) {
  db.sqlite.prepare("INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, 'Mission', 'active', 3, 'seed', ?, ?)").run(campaignId, timestamp, timestamp);
  db.sqlite.prepare("INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES ('team_a', ?, 'Team A', '#2563eb', ?, ?)").run(campaignId, timestamp, timestamp);
  db.sqlite.prepare("INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES ('area_a', ?, 'team_a', 'Area A', ?, ?, ?)").run(
    campaignId,
    JSON.stringify({ type: "Polygon", coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]] }),
    timestamp,
    timestamp,
  );
}

test("RxDB Area rename rebases over unrelated canonical geometry and converges without rejection loop", async () => {
  const db = new SqliteD1();
  const campaignId = `campaign_rebase_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
  seedD1(db, campaignId);
  const access: AccessContext = {
    grantId: "grant_admin",
    campaignId,
    role: "admin",
    teamId: null,
    label: "Admin",
  };

  const assumedGeometry = {
    type: "Polygon" as const,
    coordinates: [[[8.6, 49.4], [8.7, 49.4], [8.7, 49.5], [8.6, 49.4]]],
  };
  const canonicalGeometry = {
    type: "Polygon" as const,
    coordinates: [[[8.6, 49.4], [8.72, 49.4], [8.72, 49.52], [8.6, 49.4]]],
  };
  const assumed = {
    id: "area_a",
    campaignId,
    teamId: "team_a",
    name: "Area A",
    geometry: assumedGeometry,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const next = {
    ...assumed,
    name: "Area A neu",
    updatedAt: clientUpdateAt,
  };

  // Simulate an independent canonical update that landed after this client's
  // master state. This used to make every later Area write fail solely because
  // updatedAt no longer matched, even though the renamed field was untouched.
  db.sqlite.prepare("UPDATE areas SET geometry_json = ?, updated_at = ? WHERE campaign_id = ? AND id = 'area_a'").run(
    JSON.stringify(canonicalGeometry),
    canonicalUpdateAt,
    campaignId,
  );
  db.sqlite.prepare("UPDATE campaigns SET revision = 4, updated_at = ? WHERE id = ?").run(canonicalUpdateAt, campaignId);

  const requestBody = { rows: [{ assumedMasterState: assumed, newDocumentState: next }] };
  const firstResponse = await handleRxdbPush(db, campaignId, "areas", access, requestBody);
  assert.equal(firstResponse.status, 200);
  const firstBody = await firstResponse.json() as {
    conflicts: Array<{ id: string; name: string; geometry: typeof canonicalGeometry }>;
    rejections: Array<{ documentId: string; code: string }>;
  };

  assert.deepEqual(firstBody.rejections, [], "safe field-level rebase must not trigger the generic rejected-change banner");
  assert.equal(firstBody.conflicts.length, 1, "RxDB should receive the merged canonical master when an unrelated field differs");
  assert.equal(firstBody.conflicts[0]?.id, "area_a");
  assert.equal(firstBody.conflicts[0]?.name, "Area A neu");
  assert.deepEqual(firstBody.conflicts[0]?.geometry, canonicalGeometry);

  const afterFirst = await loadCampaignSnapshot(db, campaignId);
  assert.equal(afterFirst?.areas[0]?.name, "Area A neu", "the user rename must survive canonical convergence");
  assert.deepEqual(afterFirst?.areas[0]?.geometry, canonicalGeometry, "the independent canonical geometry must also survive");
  assert.equal(afterFirst?.revision, 5);

  // A lost response/retry with the old assumed master used to enter another
  // conflict cycle. Once the desired name is canonical the retry is a clean ACK.
  const retryResponse = await handleRxdbPush(db, campaignId, "areas", access, requestBody);
  assert.equal(retryResponse.status, 200);
  const retryBody = await retryResponse.json() as { conflicts: unknown[]; rejections: unknown[] };
  assert.deepEqual(retryBody, { conflicts: [], rejections: [] });

  const afterRetry = await loadCampaignSnapshot(db, campaignId);
  assert.equal(afterRetry?.areas[0]?.name, "Area A neu");
  assert.deepEqual(afterRetry?.areas[0]?.geometry, canonicalGeometry);
  assert.equal(afterRetry?.revision, 5, "idempotent retry must not create a second domain mutation");
});

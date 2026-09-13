import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import { handleRxdbPush } from "../worker/rxdbSync.ts";

const campaignId = "campaign_rxdb_server_wins";
const timestamp = "2026-09-14T00:00:00.000Z";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(readonly query: string, private readonly sqlite: DatabaseSync) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.sqlite.prepare(this.query).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.sqlite.prepare(this.query).all(...this.values) as T[] }; }
  run() { return this.sqlite.prepare(this.query).run(...this.values); }
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
      "0022_street_house_network.sql",
      "0023_street_base_chunks.sql",
    ]) this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  prepare(query: string) { return new Statement(query, this.sqlite); }
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

class FailingAreaDeleteD1 extends SqliteD1 {
  override async batch(statements: D1PreparedStatement[]) {
    if ((statements as Statement[]).some((statement) => /DELETE FROM areas\b/.test(statement.query))) {
      throw new Error("simulated_area_delete_write_failure");
    }
    return super.batch(statements);
  }
}

function seed(db: SqliteD1) {
  db.sqlite.prepare("INSERT INTO campaigns (id,name,status,revision,write_token,created_at,updated_at) VALUES (?,'Mission','active',3,'seed',?,?)").run(campaignId,timestamp,timestamp);
  db.sqlite.prepare("INSERT INTO teams (id,campaign_id,name,color,created_at,updated_at) VALUES ('team_a',?,'Team A','#2563eb',?,?)").run(campaignId,timestamp,timestamp);
  const geometry = JSON.stringify({ type: "Polygon", coordinates: [[[8.6,49.4],[8.7,49.4],[8.7,49.5],[8.6,49.4]]] });
  db.sqlite.prepare("INSERT INTO areas (id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES ('area_a',?,'team_a','Area A',?,?,?)").run(campaignId,geometry,timestamp,timestamp);
  db.sqlite.prepare("INSERT INTO area_task_preparations(campaign_id,area_id,geometry_hash,generation,status,road_count,house_count,updated_at) VALUES (?,'area_a','hash','gen','ready',1,1,?)").run(campaignId,timestamp);
  db.sqlite.prepare("INSERT INTO street_base_areas(campaign_id,area_id,generation) VALUES (?,'area_a','gen')").run(campaignId);
  db.sqlite.prepare("INSERT INTO street_base_chunks(campaign_id,area_id,content_hash,kind,bucket,payload_json) VALUES (?,'area_a','hash-road','street',0,'[]')").run(campaignId);
}

const access: AccessContext = { grantId: "grant_admin", campaignId, role: "admin", teamId: null, label: "Admin" };
const area = {
  id: "area_a", campaignId, teamId: "team_a", name: "Area A",
  geometry: { type: "Polygon" as const, coordinates: [[[8.6,49.4],[8.7,49.4],[8.7,49.5],[8.6,49.4]]] },
  createdAt: timestamp, updatedAt: timestamp,
};

function deleteBody() {
  return { rows: [{ assumedMasterState: area, newDocumentState: { ...area, _deleted: true } }] };
}

test("prepared Area delete explicitly clears StreetEngine storage and succeeds", async () => {
  const db = new SqliteD1();
  seed(db);
  const response = await handleRxdbPush(db, campaignId, "areas", access, deleteBody());
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { conflicts: [], rejections: [] });
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM areas WHERE id='area_a'").get()!.n, 0);
  for (const table of ["area_task_preparations","street_base_areas","street_base_chunks"]) {
    assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 0, table);
  }
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("failed Area delete becomes server-wins instead of an endless RxDB 5xx retry", async () => {
  const db = new FailingAreaDeleteD1();
  seed(db);
  const response = await handleRxdbPush(db, campaignId, "areas", access, deleteBody());
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json() as { conflicts: Array<{ id: string; _deleted?: boolean }>; rejections: Array<{ documentId: string; code: string }> };
  assert.equal(body.conflicts.length, 1);
  assert.equal(body.conflicts[0]?.id, "area_a");
  assert.notEqual(body.conflicts[0]?._deleted, true);
  assert.deepEqual(body.rejections, [{ documentId: "area_a", code: "simulated_area_delete_write_failure" }]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM areas WHERE id='area_a'").get()!.n, 1);
  assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
});

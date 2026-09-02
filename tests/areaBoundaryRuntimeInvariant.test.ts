import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { lineStringInsidePolygon } from "../worker/streetPreparation/clipRoadsToArea.ts";
import type { LineStringGeometry, PolygonGeometry } from "../src/domain/campaign.ts";
import { prepareAreaTasks } from "../worker/areaTaskPreparation.ts";
import {
  loadCampaignSnapshot,
  type D1DatabaseLike,
  type D1PreparedStatement,
  type D1RunResult,
} from "../worker/campaignRepository.ts";

class SqliteStatement implements D1PreparedStatement {
  values: unknown[] = [];

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
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    for (const migration of [
      "0001_initial.sql",
      "0002_m4_access.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
  }

  prepare(query: string) {
    return new SqliteStatement(query, this.sqlite);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = (statements as SqliteStatement[]).map<D1RunResult>((statement) => {
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

const campaignId = "campaign_boundary-runtime";
const areaId = "area_boundary-runtime";
const teamId = "team_boundary-runtime";
const timestamp = "2026-09-01T20:30:00.000Z";
const areaGeometry: PolygonGeometry = {
  type: "Polygon",
  coordinates: [[
    [13.700, 51.000], [13.710, 51.000], [13.710, 51.010],
    [13.700, 51.010], [13.700, 51.000],
  ]],
};

function seed(db: SqliteD1) {
  db.sqlite.prepare(
    "INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, ?, 'active', 3, 'seed-token', ?, ?)",
  ).run(campaignId, "Boundary Runtime", timestamp, timestamp);
  db.sqlite.prepare(
    "INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) VALUES (?, ?, ?, '#2563eb', ?, ?)",
  ).run(teamId, campaignId, "Team", timestamp, timestamp);
  db.sqlite.prepare(
    "INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(areaId, campaignId, teamId, "Area", JSON.stringify(areaGeometry), timestamp, timestamp);
}

function osmResponse() {
  return new Response(JSON.stringify({
    osm3s: { timestamp_osm_base: timestamp },
    elements: [{
      type: "way",
      id: 100,
      tags: { highway: "residential", name: "Gebietsstraße" },
      geometry: [{ lon: 13.699, lat: 51.005 }, { lon: 13.711, lat: 51.005 }],
    }],
  }));
}

test("D1 publication and canonical snapshot preserve only clipped automatic Street geometry", async () => {
  const db = new SqliteD1();
  seed(db);
  let counter = 0;
  const result = await prepareAreaTasks(db, campaignId, areaId, {
    upstreamUrl: "http://localhost/overpass",
    now: () => new Date(timestamp),
    randomUUID: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    fetchImpl: async () => osmResponse(),
  });

  assert.equal(result.outcome, "ready");
  const row = db.sqlite.prepare(
    "SELECT geometry_json FROM tasks WHERE campaign_id = ? AND area_id = ? AND area_preparation_generation IS NOT NULL",
  ).get(campaignId, areaId) as { geometry_json: string };
  const stored = JSON.parse(row.geometry_json) as LineStringGeometry;
  const expected: LineStringGeometry = { type: "LineString", coordinates: [[13.700, 51.005], [13.710, 51.005]] };
  assert.deepEqual(stored, expected);
  assert.equal(row.geometry_json.includes("13.699"), false);
  assert.equal(row.geometry_json.includes("13.711"), false);
  assert.equal(lineStringInsidePolygon(stored, areaGeometry), true);

  const snapshot = await loadCampaignSnapshot(db, campaignId);
  const automatic = snapshot?.tasks.find((task) => task.areaPreparationGeneration !== null);
  assert.ok(automatic);
  assert.deepEqual(automatic.geometry, expected);
  assert.equal(lineStringInsidePolygon(automatic.geometry, areaGeometry), true);
});

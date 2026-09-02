import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { augmentPickupSnapshotResponse } from "../worker/indexFc52.ts";

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, readonly query: string) {}
  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }
  async first<T>() {
    return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null;
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

const migrations = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
];

function database(withPickupSchema: boolean) {
  const db = new SqliteD1();
  const files = withPickupSchema ? migrations : migrations.slice(0, -1);
  for (const file of files) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_read_pickups', 'Read', 'active', 4, 'token',
             '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  return db;
}

function baseSnapshotResponse() {
  return Response.json(
    {
      schemaVersion: 3,
      revision: 4,
      campaign: {
        id: "campaign_read_pickups",
        name: "Read",
        status: "active",
        defaultMapView: null,
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z",
      },
      teams: [],
      areas: [],
      tasks: [],
      houseTasks: [],
      collection: { mainArea: null, areas: [], runs: [] },
    },
    { headers: { etag: '"campaign_read_pickups:4:collection"' } },
  );
}

test("FC5.2 snapshot augmentation fails closed when migration 0011 is missing", async () => {
  const db = database(false);
  const response = await augmentPickupSnapshotResponse(
    baseSnapshotResponse(),
    db,
    "campaign_read_pickups",
  );
  assert.equal(response.status, 503);
  const body = (await response.json()) as { error: { code: string }; revision: number };
  assert.equal(body.error.code, "pickup_schema_unavailable");
  assert.equal(body.revision, 4);
});

test("FC5.2 snapshot augmentation returns canonical Pickup rows without inventing data", async () => {
  const db = database(true);
  db.raw.prepare(
    `INSERT INTO collection_pickups (
       id, campaign_id, area_id, title, address, description, longitude, latitude,
       status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
       source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
       created_at, updated_at
     ) VALUES (
       'collection_pickup_read', 'campaign_read_pickups', NULL,
       'Abholung', 'Hauptstraße 1', 'Seiteneingang', 10.1, 50.2,
       'needs-follow-up', NULL, '[]', '[]', ?,
       'campaign-grant', 'grant_admin', 'campaign-grant', 'grant_admin',
       '2026-08-30T12:01:00.000Z', '2026-08-30T12:02:00.000Z'
     )`,
  ).run(JSON.stringify({
    kind: "osm-address",
    provider: "geoapify",
    placeId: "place-read",
    osmType: "node",
    osmId: "123",
  }));

  const response = await augmentPickupSnapshotResponse(
    baseSnapshotResponse(),
    db,
    "campaign_read_pickups",
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("etag"), '"campaign_read_pickups:4:collection"');
  const body = (await response.json()) as {
    collection: { pickups: Array<Record<string, unknown>> };
  };
  assert.equal(body.collection.pickups.length, 1);
  assert.deepEqual(body.collection.pickups[0], {
    id: "collection_pickup_read",
    campaignId: "campaign_read_pickups",
    areaId: null,
    title: "Abholung",
    address: "Hauptstraße 1",
    description: "Seiteneingang",
    position: [10.1, 50.2],
    status: "needs-follow-up",
    archivedAt: null,
    assignedRunIds: [],
    assignedCollectorIds: [],
    source: {
      kind: "osm-address",
      provider: "geoapify",
      placeId: "place-read",
      osmType: "node",
      osmId: "123",
    },
    createdBy: { kind: "campaign-grant", ref: "grant_admin" },
    updatedBy: { kind: "campaign-grant", ref: "grant_admin" },
    createdAt: "2026-08-30T12:01:00.000Z",
    updatedAt: "2026-08-30T12:02:00.000Z",
  });
});

test("FC5.2 wrapper leaves snapshots without Collection untouched", async () => {
  const db = database(false);
  const original = Response.json({ schemaVersion: 3, revision: 4 });
  const response = await augmentPickupSnapshotResponse(
    original,
    db,
    "campaign_read_pickups",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 3, revision: 4 });
});

test("Wrangler points at the FC5.2 wrapper without changing the previous worker chain", () => {
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(config, /"main": "\.\/worker\/indexFc52\.ts"/u);
  const wrapper = readFileSync(new URL("../worker/indexFc52.ts", import.meta.url), "utf8");
  assert.match(wrapper, /import baseWorker from "\.\/indexM55\.ts"/u);
});

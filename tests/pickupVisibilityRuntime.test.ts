import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hashSecret, type AccessContext } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { augmentPickupSnapshotResponse } from "../worker/indexFc52.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import type { PickupMutation } from "../src/domain/pickupMutation.ts";

const migrations = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
  "0012_fc5_collection_pickup_visibility.sql",
];

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

function database() {
  const db = new SqliteD1();
  for (const file of migrations) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const stamp = "2026-08-31T00:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
  });
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_visibility', 'Visibility', 'active', 0, 'write-token', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_access_links (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('access_visibility', 'campaign_visibility', 'access-hash', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_visibility', 'campaign_visibility', 'access_visibility', 'Nutzer 1', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('main_visibility', 'campaign_visibility', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('area_visibility', 'campaign_visibility', 'main_visibility', 'Nord', ?, '#2563eb',
             'open', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_pickups (
       id, campaign_id, area_id, title, address, description, longitude, latitude,
       status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
       source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
       created_at, updated_at
     ) VALUES (
       'pickup_visibility', 'campaign_visibility', 'area_visibility', 'Geheimer Pickup',
       'Hauptstraße 1', 'Seiteneingang', 10.05, 50.05, 'open', NULL, '[]', '[]', NULL,
       'campaign-grant', 'grant_admin', 'campaign-grant', 'grant_admin', ?, ?)`,
  ).run(stamp, stamp);
  return db;
}

async function collectorRequest(db: SqliteD1) {
  const secret = "visibility-collector-session";
  const stamp = "2026-08-31T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO collection_collector_sessions
       (id, collector_id, campaign_id, session_hash, created_at, expires_at, revoked_at)
     VALUES ('session_visibility', 'collector_visibility', 'campaign_visibility', ?, ?,
             '2099-01-01T00:00:00.000Z', NULL)`,
  ).run(await hashSecret(secret), stamp);
  return new Request("https://flyer.test/api/campaigns/campaign_visibility/collection/snapshot", {
    headers: { cookie: `vf_collection_session=${encodeURIComponent(secret)}` },
  });
}

async function adminRequest(db: SqliteD1) {
  const secret = "visibility-admin-session";
  const stamp = "2026-08-31T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_visibility_admin', 'campaign_visibility', 'admin', NULL,
             'token-hash', 'Admin', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
     VALUES ('campaign_session_visibility', 'grant_visibility_admin', 'campaign_visibility', ?, ?,
             '2099-01-01T00:00:00.000Z')`,
  ).run(await hashSecret(secret), stamp);
  return new Request("https://flyer.test/api/campaigns/campaign_visibility/collection/snapshot", {
    headers: { cookie: `vf_session=${encodeURIComponent(secret)}` },
  });
}

function baseResponse() {
  return Response.json({
    schemaVersion: 3,
    revision: 0,
    campaign: { id: "campaign_visibility" },
    teams: [{ id: "distribution-team" }],
    areas: [{ id: "distribution-area" }],
    tasks: [{ id: "distribution-task" }],
    houseTasks: [{ id: "distribution-house" }],
    collection: {
      mainArea: { id: "main_visibility" },
      areas: [{ id: "area_visibility" }],
      runs: [{ id: "run-visible-sentinel" }],
    },
  });
}

test("Collector view=true sees Pickups while collection and Distribution context stay unchanged", async () => {
  const db = database();
  const request = await collectorRequest(db);
  const response = await augmentPickupSnapshotResponse(
    baseResponse(),
    db,
    "campaign_visibility",
    request,
  );
  const body = (await response.json()) as Record<string, any>;
  assert.equal(body.collection.pickups.length, 1);
  assert.equal(body.collection.pickups[0].title, "Geheimer Pickup");
  assert.deepEqual(body.collection.areas, [{ id: "area_visibility" }]);
  assert.deepEqual(body.collection.runs, [{ id: "run-visible-sentinel" }]);
  assert.deepEqual(body.teams, [{ id: "distribution-team" }]);
  assert.deepEqual(body.tasks, [{ id: "distribution-task" }]);
});

test("Collector view=false gets zero Pickup data without losing Areas or Runs", async () => {
  const db = database();
  const request = await collectorRequest(db);
  db.raw.prepare(
    `UPDATE collection_collectors
        SET can_view_pickups = 0,
            can_create_pickups = 1,
            can_edit_pickups = 1,
            can_assign_pickups = 1
      WHERE id = 'collector_visibility'`,
  ).run();
  const response = await augmentPickupSnapshotResponse(
    baseResponse(),
    db,
    "campaign_visibility",
    request,
  );
  const text = await response.text();
  const body = JSON.parse(text) as Record<string, any>;
  assert.deepEqual(body.collection.pickups, []);
  assert.deepEqual(body.collection.areas, [{ id: "area_visibility" }]);
  assert.deepEqual(body.collection.runs, [{ id: "run-visible-sentinel" }]);
  assert.doesNotMatch(text, /Geheimer Pickup|Hauptstraße 1|Seiteneingang|10\.05|50\.05/u);
});

test("normal Campaign admin keeps Pickup visibility independent from Collector flags", async () => {
  const db = database();
  db.raw.prepare(
    "UPDATE collection_collectors SET can_view_pickups = 0 WHERE id = 'collector_visibility'",
  ).run();
  const request = await adminRequest(db);
  const response = await augmentPickupSnapshotResponse(
    baseResponse(),
    db,
    "campaign_visibility",
    request,
  );
  const body = (await response.json()) as Record<string, any>;
  assert.equal(body.collection.pickups.length, 1);
});

test("view=false blocks Pickup mutation even if write flags were forged true", async () => {
  const db = database();
  db.raw.prepare(
    `UPDATE collection_collectors
        SET can_view_pickups = 0, can_create_pickups = 1
      WHERE id = 'collector_visibility'`,
  ).run();
  const access: AccessContext = {
    grantId: "collection:collector_visibility",
    campaignId: "campaign_visibility",
    role: "collection-collector",
    teamId: null,
    label: "Nutzer 1",
    collectorId: "collector_visibility",
    collectionAccessId: "access_visibility",
  };
  const mutation: PickupMutation = {
    id: "mutation_visibility_create",
    campaignId: "campaign_visibility",
    type: "collection.pickup.create",
    payload: {
      pickupId: "collection_pickup_visibility_second",
      areaId: "area_visibility",
      title: "Zweiter Pickup",
      address: "Hauptstraße 2",
      description: "",
      position: [10.04, 50.04],
      source: null,
    },
    baseRevision: 0,
    createdAt: "2026-08-31T00:05:00.000Z",
  };
  const response = await handleCampaignMutation(
    new Request("https://flyer.test/api/campaigns/campaign_visibility/mutations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutation }),
    }),
    db,
    "campaign_visibility",
    access,
  );
  assert.equal(response.status, 403);
  assert.equal(((await response.json()) as { error: { code: string } }).error.code, "pickup_capability_forbidden");
  assert.equal(
    db.raw.prepare("SELECT COUNT(*) AS count FROM collection_pickups").get()?.count,
    1,
  );
});

test("current statistics do not derive hidden Pickup counts and Map rendering stays capability-gated", () => {
  const statistics = readFileSync(new URL("../worker/statistics.ts", import.meta.url), "utf8");
  assert.doesNotMatch(statistics, /collection_pickups|pickup.*count/iu);

  const mapView = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mapView, /collection_pickups/iu);

  const collector = readFileSync(
    new URL("../src/collection/CollectionCollectorView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    collector,
    /pickupCapabilities\.canViewPickups\s*\?\s*collection\.pickups\s*:\s*\[\]/u,
  );

  const renderer = readFileSync(new URL("../src/map/pickupRenderer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /address|description|createdBy|updatedBy|source|provider|osmId/iu);
});

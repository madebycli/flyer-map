import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationFiles = [
  "0001_initial.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
];

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  db.prepare(
    `INSERT INTO campaigns
       (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_pickup', 'Pickup', 'active', 0, 'write-token',
             '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  return db;
}

function seedCollectionArea(db: DatabaseSync) {
  const stamp = "2026-08-30T12:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
  });
  db.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_pickup', 'campaign_pickup', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('collection_area_pickup', 'campaign_pickup', 'collection_main_pickup', 'Nord', ?,
             '#2563eb', 'open', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(polygon, stamp, stamp);
}

function insertPickup(db: DatabaseSync) {
  db.prepare(
    `INSERT INTO collection_pickups
       (id, campaign_id, area_id, title, address, description, longitude, latitude,
        status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
        source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
        created_at, updated_at)
     VALUES ('collection_pickup_one', 'campaign_pickup', 'collection_area_pickup',
             'Abholung', 'Hauptstraße 1', '', 10.05, 50.05, 'open', NULL, '[]', '[]',
             ?, 'campaign-grant', 'grant_admin', 'campaign-grant', 'grant_admin',
             '2026-08-30T12:05:00.000Z', '2026-08-30T12:05:00.000Z')`,
  ).run(JSON.stringify({ kind: "distribution-house", taskId: "task_distribution_source" }));
}

test("prepared Pickup migration is additive and Collector capabilities default deny", () => {
  const db = database();
  db.prepare(
    `INSERT INTO collection_access_links (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('collection_access_pickup', 'campaign_pickup', 'hash', '2026-08-30T12:00:00.000Z', NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_pickup', 'campaign_pickup', 'collection_access_pickup', 'Nutzer 1',
             '2026-08-30T12:00:00.000Z', NULL)`,
  ).run();

  const collector = db.prepare(
    `SELECT can_create_pickups, can_edit_pickups, can_assign_pickups
       FROM collection_collectors WHERE id = 'collector_pickup'`,
  ).get() as Record<string, number>;
  assert.deepEqual(collector, {
    can_create_pickups: 0,
    can_edit_pickups: 0,
    can_assign_pickups: 0,
  });
});

test("Pickup Area scope stays consistent while Distribution deletion remains independent", () => {
  const db = database();
  seedCollectionArea(db);

  db.prepare(
    `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
     VALUES ('team_distribution', 'campaign_pickup', 'Team', '#ea580c',
             '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at)
     VALUES ('area_distribution', 'campaign_pickup', 'team_distribution', 'Verteilung',
             '{"type":"Polygon","coordinates":[[[10,50],[10.1,50],[10.1,50.1],[10,50]]]}',
             '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  db.prepare(
    `INSERT INTO tasks
       (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at,
        created_at, updated_at)
     VALUES ('task_distribution_source', 'campaign_pickup', 'area_distribution', 'street',
             'Straße', '{"type":"LineString","coordinates":[[10,50],[10.1,50.1]]}',
             'open', NULL, '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')`,
  ).run();
  insertPickup(db);

  db.prepare("DELETE FROM tasks WHERE id = 'task_distribution_source'").run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM collection_pickups").get() as { count: number }).count,
    1,
  );

  assert.throws(
    () => db.prepare("DELETE FROM collection_areas WHERE id = 'collection_area_pickup'").run(),
    /FOREIGN KEY constraint failed/u,
  );

  db.prepare(
    `UPDATE collection_pickups
        SET status = 'collected', archived_at = '2026-08-30T13:00:00.000Z'
      WHERE id = 'collection_pickup_one'`,
  ).run();
  const archived = db.prepare(
    "SELECT status, archived_at FROM collection_pickups WHERE id = 'collection_pickup_one'",
  ).get() as { status: string; archived_at: string | null };
  assert.equal(archived.status, "collected");
  assert.equal(archived.archived_at, "2026-08-30T13:00:00.000Z");

  db.prepare("DELETE FROM campaigns WHERE id = 'campaign_pickup'").run();
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM collection_pickups").get() as { count: number }).count,
    0,
  );
});

test("Pickup assignment JSON columns accept arrays only", () => {
  const db = database();
  seedCollectionArea(db);
  assert.throws(
    () => db.prepare(
      `INSERT INTO collection_pickups
         (id, campaign_id, area_id, title, address, description, longitude, latitude,
          status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
          source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
          created_at, updated_at)
       VALUES ('collection_pickup_bad_json', 'campaign_pickup', NULL, 'Bad', 'Adresse', '',
               10, 50, 'open', NULL, '{}', '[]', NULL,
               'campaign-grant', 'grant_admin', 'campaign-grant', 'grant_admin',
               '2026-08-30T12:05:00.000Z', '2026-08-30T12:05:00.000Z')`,
    ).run(),
    /CHECK constraint failed/u,
  );
});

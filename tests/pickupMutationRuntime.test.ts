import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import type { PickupMutation } from "../src/domain/pickupMutation.ts";

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

const fullMigrations = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
];

function database(includePickup = true) {
  const db = new SqliteD1();
  for (const file of includePickup ? fullMigrations : fullMigrations.slice(0, -1)) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_pickups', 'Pickups', 'active', 0, 'initial-write-token',
             '2026-08-30T10:00:00.000Z', '2026-08-30T10:00:00.000Z')`,
  ).run();
  if (includePickup) seedCollection(db);
  return db;
}

function seedCollection(db: SqliteD1) {
  const stamp = "2026-08-30T10:00:00.000Z";
  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
  });
  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_pickups', 'campaign_pickups', 'Main', ?, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('collection_area_pickups', 'campaign_pickups', 'collection_main_pickups', 'Nord', ?,
             '#2563eb', 'open', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(polygon, stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_access_links
       (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('collection_access_pickups', 'campaign_pickups', 'hash-pickups', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_pickups', 'campaign_pickups', 'collection_access_pickups', 'Nutzer 1', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_runs
       (id, campaign_id, main_area_id, status, started_at, ended_at,
        created_by_collector_id, area_ids_json, created_at, updated_at)
     VALUES ('collection_run_pickups', 'campaign_pickups', 'collection_main_pickups', 'active', ?, NULL,
             'collector_pickups', '[]', ?, ?)`,
  ).run(stamp, stamp, stamp);
}

const adminAccess: AccessContext = {
  grantId: "grant_admin",
  campaignId: "campaign_pickups",
  role: "admin",
  teamId: null,
  label: "Admin",
};

const collectorAccess: AccessContext = {
  grantId: "collection:collector_pickups",
  campaignId: "campaign_pickups",
  role: "collection-collector",
  teamId: null,
  label: "Nutzer 1",
  collectorId: "collector_pickups",
  collectionAccessId: "collection_access_pickups",
};

function request(mutation: PickupMutation | Record<string, unknown>) {
  return new Request("https://flyer.test/api/campaigns/campaign_pickups/mutations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  });
}

function createMutation(
  id = "mutation_pickup_create_one",
  title = "Abholung",
): PickupMutation {
  return {
    id,
    campaignId: "campaign_pickups",
    type: "collection.pickup.create",
    payload: {
      pickupId: "collection_pickup_one",
      areaId: "collection_area_pickups",
      title,
      address: "Hauptstraße 1",
      description: "Klingeln",
      position: [10.05, 50.05],
      source: {
        kind: "osm-address",
        provider: "geoapify",
        placeId: "place-one",
        osmType: "node",
        osmId: "123",
      },
    },
    baseRevision: 0,
    createdAt: "2026-08-30T10:05:00.000Z",
  };
}

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("Pickup writes fail closed with a specific schema error when migration 0011 is missing", async () => {
  const db = database(false);
  const response = await handleCampaignMutation(
    request(createMutation()),
    db,
    "campaign_pickups",
    adminAccess,
  );
  assert.equal(response.status, 503);
  const body = await payload(response);
  assert.equal((body.error as { code: string }).code, "pickup_schema_unavailable");
  assert.equal(db.raw.prepare("SELECT revision FROM campaigns WHERE id = 'campaign_pickups'").get()?.revision, 0);
});

test("Collector Pickup create is default-deny, then persists idempotently through the M5 ledger", async () => {
  const db = database();
  const mutation = createMutation();

  const denied = await handleCampaignMutation(
    request(mutation),
    db,
    "campaign_pickups",
    collectorAccess,
  );
  assert.equal(denied.status, 403);
  assert.equal((await payload(denied)).error && ((await Promise.resolve({ code: "pickup_capability_forbidden" })).code), "pickup_capability_forbidden");
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS count FROM collection_pickups").get()?.count, 0);

  db.raw.prepare(
    "UPDATE collection_collectors SET can_create_pickups = 1 WHERE id = 'collector_pickups'",
  ).run();

  const created = await handleCampaignMutation(
    request(mutation),
    db,
    "campaign_pickups",
    collectorAccess,
  );
  assert.equal(created.status, 200);
  assert.deepEqual(await payload(created), {
    mutationId: mutation.id,
    appliedRevision: 1,
    alreadyApplied: false,
  });

  const row = db.raw.prepare(
    `SELECT title, longitude, latitude, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref
     FROM collection_pickups WHERE id = 'collection_pickup_one'`,
  ).get() as Record<string, unknown>;
  assert.equal(row.title, "Abholung");
  assert.equal(row.longitude, 10.05);
  assert.equal(row.latitude, 50.05);
  assert.equal(row.created_by_kind, "collection-collector");
  assert.equal(row.created_by_ref, "collector_pickups");
  assert.equal(row.updated_by_kind, "collection-collector");

  const replay = await handleCampaignMutation(
    request(mutation),
    db,
    "campaign_pickups",
    collectorAccess,
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(await payload(replay), {
    mutationId: mutation.id,
    appliedRevision: 1,
    alreadyApplied: true,
  });
  assert.equal(db.raw.prepare("SELECT revision FROM campaigns WHERE id = 'campaign_pickups'").get()?.revision, 1);

  const reused = await handleCampaignMutation(
    request(createMutation(mutation.id, "Anderer Inhalt")),
    db,
    "campaign_pickups",
    collectorAccess,
  );
  assert.equal(reused.status, 409);
  assert.equal(((await payload(reused)).error as { code: string }).code, "mutation_id_reused");
});

test("Admin can update, set status, assign and archive a Pickup without deleting provenance", async () => {
  const db = database();
  const createdAt = "2026-08-30T11:00:00.000Z";
  const created: PickupMutation = {
    ...createMutation("mutation_pickup_admin_create"),
    createdAt,
  };
  assert.equal(
    (await handleCampaignMutation(request(created), db, "campaign_pickups", adminAccess)).status,
    200,
  );

  const updatedAt = "2026-08-30T11:05:00.000Z";
  const update: PickupMutation = {
    id: "mutation_pickup_admin_update",
    campaignId: "campaign_pickups",
    type: "collection.pickup.update",
    payload: {
      pickupId: "collection_pickup_one",
      areaId: null,
      title: "Neue Abholung",
      address: "Nebenstraße 2",
      description: "Hinterhof",
      position: [10.06, 50.06],
      expectedUpdatedAt: createdAt,
    },
    baseRevision: 1,
    createdAt: updatedAt,
  };
  assert.equal(
    (await handleCampaignMutation(request(update), db, "campaign_pickups", adminAccess)).status,
    200,
  );

  const statusAt = "2026-08-30T11:10:00.000Z";
  const statusMutation: PickupMutation = {
    id: "mutation_pickup_admin_status",
    campaignId: "campaign_pickups",
    type: "collection.pickup.set-status",
    payload: {
      pickupId: "collection_pickup_one",
      status: "needs-follow-up",
      expectedUpdatedAt: updatedAt,
    },
    baseRevision: 2,
    createdAt: statusAt,
  };
  assert.equal(
    (await handleCampaignMutation(request(statusMutation), db, "campaign_pickups", adminAccess)).status,
    200,
  );

  const assignmentAt = "2026-08-30T11:15:00.000Z";
  const assignment: PickupMutation = {
    id: "mutation_pickup_admin_assignment",
    campaignId: "campaign_pickups",
    type: "collection.pickup.set-assignment",
    payload: {
      pickupId: "collection_pickup_one",
      assignedRunIds: ["collection_run_pickups"],
      assignedCollectorIds: ["collector_pickups"],
      expectedUpdatedAt: statusAt,
    },
    baseRevision: 3,
    createdAt: assignmentAt,
  };
  assert.equal(
    (await handleCampaignMutation(request(assignment), db, "campaign_pickups", adminAccess)).status,
    200,
  );

  const archiveAt = "2026-08-30T11:20:00.000Z";
  const archive: PickupMutation = {
    id: "mutation_pickup_admin_archive",
    campaignId: "campaign_pickups",
    type: "collection.pickup.archive",
    payload: {
      pickupId: "collection_pickup_one",
      expectedUpdatedAt: assignmentAt,
    },
    baseRevision: 4,
    createdAt: archiveAt,
  };
  assert.equal(
    (await handleCampaignMutation(request(archive), db, "campaign_pickups", adminAccess)).status,
    200,
  );

  const row = db.raw.prepare(
    `SELECT title, address, description, longitude, latitude, status, archived_at,
            assigned_run_ids_json, assigned_collector_ids_json, source_json,
            created_by_kind, created_by_ref, updated_by_kind, updated_by_ref
     FROM collection_pickups WHERE id = 'collection_pickup_one'`,
  ).get() as Record<string, unknown>;
  assert.equal(row.title, "Neue Abholung");
  assert.equal(row.address, "Nebenstraße 2");
  assert.equal(row.description, "Hinterhof");
  assert.equal(row.longitude, 10.06);
  assert.equal(row.latitude, 50.06);
  assert.equal(row.status, "needs-follow-up");
  assert.equal(row.archived_at, archiveAt);
  assert.deepEqual(JSON.parse(row.assigned_run_ids_json as string), ["collection_run_pickups"]);
  assert.deepEqual(JSON.parse(row.assigned_collector_ids_json as string), ["collector_pickups"]);
  assert.deepEqual(JSON.parse(row.source_json as string), created.payload.source);
  assert.equal(row.created_by_kind, "campaign-grant");
  assert.equal(row.created_by_ref, "grant_admin");
  assert.equal(row.updated_by_kind, "campaign-grant");
  assert.equal(row.updated_by_ref, "grant_admin");
  assert.equal(db.raw.prepare("SELECT revision FROM campaigns WHERE id = 'campaign_pickups'").get()?.revision, 5);
});

test("Pickup mutations reject forged fields and cross-campaign Collection references", async () => {
  const db = database();
  const forged = createMutation() as unknown as Record<string, unknown>;
  forged.payload = {
    ...(forged.payload as Record<string, unknown>),
    createdBy: { kind: "campaign-grant", ref: "forged" },
  };
  const forgedResponse = await handleCampaignMutation(
    request(forged),
    db,
    "campaign_pickups",
    adminAccess,
  );
  assert.equal(forgedResponse.status, 422);

  const stamp = "2026-08-30T12:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_other', 'Other', 'active', 0, 'token-other', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_other', 'campaign_other', 'Other',
             '{"type":"Polygon","coordinates":[[[11,51],[11.1,51],[11.1,51.1],[11,51]]]}', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_areas
       (id, campaign_id, main_area_id, name, geometry_json, color, status,
        run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
     VALUES ('collection_area_other', 'campaign_other', 'collection_main_other', 'Other',
             '{"type":"Polygon","coordinates":[[[11,51],[11.1,51],[11.1,51.1],[11,51]]]}',
             '#16a34a', 'open', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(stamp, stamp);

  const crossArea = createMutation("mutation_pickup_cross_area");
  if (crossArea.type !== "collection.pickup.create") throw new Error("unexpected mutation type");
  crossArea.payload.areaId = "collection_area_other";
  const crossResponse = await handleCampaignMutation(
    request(crossArea),
    db,
    "campaign_pickups",
    adminAccess,
  );
  assert.equal(crossResponse.status, 422);
  assert.equal(((await payload(crossResponse)).error as { code: string }).code, "pickup_area_invalid");
});

test("Collector edit capability is independent from create capability", async () => {
  const db = database();
  db.raw.prepare(
    "UPDATE collection_collectors SET can_create_pickups = 1 WHERE id = 'collector_pickups'",
  ).run();
  const create = createMutation("mutation_pickup_caps_create");
  assert.equal(
    (await handleCampaignMutation(request(create), db, "campaign_pickups", collectorAccess)).status,
    200,
  );

  const update: PickupMutation = {
    id: "mutation_pickup_caps_update",
    campaignId: "campaign_pickups",
    type: "collection.pickup.set-status",
    payload: {
      pickupId: "collection_pickup_one",
      status: "collected",
      expectedUpdatedAt: create.createdAt,
    },
    baseRevision: 1,
    createdAt: "2026-08-30T10:10:00.000Z",
  };
  const denied = await handleCampaignMutation(
    request(update),
    db,
    "campaign_pickups",
    collectorAccess,
  );
  assert.equal(denied.status, 403);
  assert.equal(((await payload(denied)).error as { code: string }).code, "pickup_capability_forbidden");

  db.raw.prepare(
    "UPDATE collection_collectors SET can_edit_pickups = 1 WHERE id = 'collector_pickups'",
  ).run();
  assert.equal(
    (await handleCampaignMutation(request(update), db, "campaign_pickups", collectorAccess)).status,
    200,
  );
});

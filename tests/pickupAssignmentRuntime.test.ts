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

const STAMP = "2026-08-31T11:30:00.000Z";
const CAMPAIGN_ID = "campaign_assignment";
const PICKUP_ID = "collection_pickup_assignment";
const RUN_ID = "collection_run_assignment";
const COLLECTOR_ID = "collector_assignment";

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

const migrations = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0003_m5_mutations.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
];

function database() {
  const db = new SqliteD1();
  for (const file of migrations) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }

  const polygon = JSON.stringify({
    type: "Polygon",
    coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50]]],
  });

  db.raw.prepare(
    `INSERT INTO campaigns
       (id, name, status, revision, write_token, created_at, updated_at)
     VALUES (?, 'Assignment', 'active', 0, 'initial-token', ?, ?)`,
  ).run(CAMPAIGN_ID, STAMP, STAMP);
  db.raw.prepare(
    `INSERT INTO collection_access_links
       (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('collection_access_assignment', ?, 'hash-assignment', ?, NULL)`,
  ).run(CAMPAIGN_ID, STAMP);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at,
        can_create_pickups, can_edit_pickups, can_assign_pickups)
     VALUES (?, ?, 'collection_access_assignment', 'Nutzer 1', ?, NULL, 0, 0, 0)`,
  ).run(COLLECTOR_ID, CAMPAIGN_ID, STAMP);
  db.raw.prepare(
    `INSERT INTO collection_main_areas
       (id, campaign_id, name, geometry_json, created_at, updated_at)
     VALUES ('collection_main_assignment', ?, 'Main', ?, ?, ?)`,
  ).run(CAMPAIGN_ID, polygon, STAMP, STAMP);
  db.raw.prepare(
    `INSERT INTO collection_runs
       (id, campaign_id, main_area_id, status, started_at, ended_at,
        created_by_collector_id, area_ids_json, created_at, updated_at)
     VALUES (?, ?, 'collection_main_assignment', 'active', ?, NULL, ?, '[]', ?, ?)`,
  ).run(RUN_ID, CAMPAIGN_ID, STAMP, COLLECTOR_ID, STAMP, STAMP);
  db.raw.prepare(
    `INSERT INTO collection_pickups
       (id, campaign_id, area_id, title, address, description, longitude, latitude,
        status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
        source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
        created_at, updated_at)
     VALUES (?, ?, NULL, 'Abholung', 'Hauptstraße 1', '', 10.05, 50.05,
             'open', NULL, '[]', '[]', NULL,
             'campaign-grant', 'grant_admin', 'campaign-grant', 'grant_admin', ?, ?)`,
  ).run(PICKUP_ID, CAMPAIGN_ID, STAMP, STAMP);

  return db;
}

const adminAccess: AccessContext = {
  grantId: "grant_admin",
  campaignId: CAMPAIGN_ID,
  role: "admin",
  teamId: null,
  label: "Admin",
};

const collectorAccess: AccessContext = {
  grantId: `collection:${COLLECTOR_ID}`,
  campaignId: CAMPAIGN_ID,
  role: "collection-collector",
  teamId: null,
  label: "Nutzer 1",
  collectorId: COLLECTOR_ID,
  collectionAccessId: "collection_access_assignment",
};

function assignmentMutation(
  id: string,
  assignedRunIds: string[] = [RUN_ID],
  assignedCollectorIds: string[] = [COLLECTOR_ID],
  expectedUpdatedAt = STAMP,
): PickupMutation {
  return {
    id,
    campaignId: CAMPAIGN_ID,
    type: "collection.pickup.set-assignment",
    payload: {
      pickupId: PICKUP_ID,
      assignedRunIds,
      assignedCollectorIds,
      expectedUpdatedAt,
    },
    baseRevision: 0,
    createdAt: "2026-08-31T11:31:00.000Z",
  };
}

function request(mutation: PickupMutation) {
  return new Request(`https://flyer.test/api/campaigns/${CAMPAIGN_ID}/mutations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation }),
  });
}

async function responsePayload(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function persistedState(db: SqliteD1) {
  const pickup = db.raw.prepare(
    `SELECT assigned_run_ids_json, assigned_collector_ids_json, updated_at
     FROM collection_pickups WHERE id = ?`,
  ).get(PICKUP_ID) as {
    assigned_run_ids_json: string;
    assigned_collector_ids_json: string;
    updated_at: string;
  };
  const revision = db.raw.prepare(
    "SELECT revision FROM campaigns WHERE id = ?",
  ).get(CAMPAIGN_ID)?.revision;
  return {
    runIds: JSON.parse(pickup.assigned_run_ids_json),
    collectorIds: JSON.parse(pickup.assigned_collector_ids_json),
    updatedAt: pickup.updated_at,
    revision,
  };
}

test("active Run and active Collector can be assigned atomically", async () => {
  const db = database();
  const response = await handleCampaignMutation(
    request(assignmentMutation("mutation_assignment_active")),
    db,
    CAMPAIGN_ID,
    adminAccess,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(persistedState(db), {
    runIds: [RUN_ID],
    collectorIds: [COLLECTOR_ID],
    updatedAt: "2026-08-31T11:31:00.000Z",
    revision: 1,
  });
});

test("closed and cancelled Runs are rejected without claiming a revision", async () => {
  for (const status of ["closed", "cancelled"] as const) {
    const db = database();
    db.raw.prepare(
      "UPDATE collection_runs SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?",
    ).run(status, "2026-08-31T11:30:30.000Z", "2026-08-31T11:30:30.000Z", RUN_ID);

    const response = await handleCampaignMutation(
      request(assignmentMutation(`mutation_assignment_${status}`)),
      db,
      CAMPAIGN_ID,
      adminAccess,
    );

    assert.equal(response.status, 422, status);
    assert.equal((await responsePayload(response)).error.code, "pickup_assignment_invalid", status);
    assert.deepEqual(persistedState(db), {
      runIds: [],
      collectorIds: [],
      updatedAt: STAMP,
      revision: 0,
    }, status);
  }
});

test("revoked Collector assignment is rejected without partial state", async () => {
  const db = database();
  db.raw.prepare(
    "UPDATE collection_collectors SET revoked_at = ? WHERE id = ?",
  ).run("2026-08-31T11:30:30.000Z", COLLECTOR_ID);

  const response = await handleCampaignMutation(
    request(assignmentMutation("mutation_assignment_revoked")),
    db,
    CAMPAIGN_ID,
    adminAccess,
  );

  assert.equal(response.status, 422);
  assert.equal((await responsePayload(response)).error.code, "pickup_assignment_invalid");
  assert.deepEqual(persistedState(db), {
    runIds: [],
    collectorIds: [],
    updatedAt: STAMP,
    revision: 0,
  });
});

test("Collector assignment is default-deny and succeeds only after can_assign_pickups is granted", async () => {
  const db = database();
  const mutation = assignmentMutation("mutation_assignment_capability");

  const denied = await handleCampaignMutation(
    request(mutation),
    db,
    CAMPAIGN_ID,
    collectorAccess,
  );
  assert.equal(denied.status, 403);
  assert.equal((await responsePayload(denied)).error.code, "pickup_capability_forbidden");
  assert.deepEqual(persistedState(db), {
    runIds: [],
    collectorIds: [],
    updatedAt: STAMP,
    revision: 0,
  });

  db.raw.prepare(
    "UPDATE collection_collectors SET can_assign_pickups = 1 WHERE id = ?",
  ).run(COLLECTOR_ID);

  const allowed = await handleCampaignMutation(
    request(mutation),
    db,
    CAMPAIGN_ID,
    collectorAccess,
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual(persistedState(db), {
    runIds: [RUN_ID],
    collectorIds: [COLLECTOR_ID],
    updatedAt: "2026-08-31T11:31:00.000Z",
    revision: 1,
  });
});

test("stale assignment conflicts without changing Pickup or Campaign revision", async () => {
  const db = database();
  const response = await handleCampaignMutation(
    request(assignmentMutation(
      "mutation_assignment_stale",
      [RUN_ID],
      [COLLECTOR_ID],
      "2026-08-31T11:29:00.000Z",
    )),
    db,
    CAMPAIGN_ID,
    adminAccess,
  );

  assert.equal(response.status, 409);
  assert.equal((await responsePayload(response)).error.code, "mutation_conflict");
  assert.deepEqual(persistedState(db), {
    runIds: [],
    collectorIds: [],
    updatedAt: STAMP,
    revision: 0,
  });
});

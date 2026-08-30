import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hashSecret } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import {
  augmentPickupCapabilitiesResponse,
  handlePickupCapabilitiesApi,
  loadPickupCapabilities,
  updatePickupCapabilities,
} from "../worker/pickupCapabilities.ts";

const migrationFiles = [
  "0001_initial.sql",
  "0002_m4_access.sql",
  "0010_fc5_collection_access_areas_runs.sql",
  "0011_fc5_collection_pickups.sql",
];
const visibilityMigration = "0012_fc5_collection_pickup_visibility.sql";

class SqliteStatement implements D1PreparedStatement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, readonly query: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null; }
  async all<T>() { return { results: this.db.prepare(this.query).all(...this.values) as T[] }; }
  run() {
    const result = this.db.prepare(this.query).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } } satisfies D1RunResult;
  }
}

class SqliteD1 implements D1DatabaseLike {
  readonly raw = new DatabaseSync(":memory:");
  prepare(query: string) { return new SqliteStatement(this.raw, query); }
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

function applyMigration(db: SqliteD1, file: string) {
  db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
}

function database(withVisibility = true) {
  const db = new SqliteD1();
  for (const file of migrationFiles) applyMigration(db, file);
  const stamp = "2026-08-31T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_caps', 'Capabilities', 'active', 0, 'write-token', ?, ?)`,
  ).run(stamp, stamp);
  db.raw.prepare(
    `INSERT INTO collection_access_links (id, campaign_id, token_hash, created_at, revoked_at)
     VALUES ('collection_access_caps', 'campaign_caps', 'link-hash', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_caps', 'campaign_caps', 'collection_access_caps', 'Nutzer 1', ?, NULL)`,
  ).run(stamp);
  if (withVisibility) applyMigration(db, visibilityMigration);
  return db;
}

async function adminCookie(db: SqliteD1) {
  const secret = "pickup-capability-admin-session";
  const stamp = "2026-08-31T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_caps_admin', 'campaign_caps', 'admin', NULL, 'token-hash', 'Admin', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
     VALUES ('session_caps_admin', 'grant_caps_admin', 'campaign_caps', ?, ?, '2099-01-01T00:00:00.000Z')`,
  ).run(await hashSecret(secret), stamp);
  return `vf_session=${encodeURIComponent(secret)}`;
}

async function collectorCookie(db: SqliteD1) {
  const secret = "pickup-capability-collector-session";
  const stamp = "2026-08-31T00:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO collection_collector_sessions
       (id, collector_id, campaign_id, session_hash, created_at, expires_at, revoked_at)
     VALUES ('collector_session_caps', 'collector_caps', 'campaign_caps', ?, ?,
             '2099-01-01T00:00:00.000Z', NULL)`,
  ).run(await hashSecret(secret), stamp);
  return `vf_collection_session=${encodeURIComponent(secret)}`;
}

const capabilityUrl = "https://flyer.test/api/campaigns/campaign_caps/collection/collectors/collector_caps/pickup-capabilities";

function put(cookie: string, body: Record<string, unknown>, url = capabilityUrl) {
  return new Request(url, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const writeFlags = {
  canCreatePickups: true,
  canEditPickups: false,
  canAssignPickups: true,
};

test("0011-only means view=true and preserves legacy write updates", async () => {
  const db = database(false);
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canViewPickups: true,
    canCreatePickups: false,
    canEditPickups: false,
    canAssignPickups: false,
  });
  assert.equal(await updatePickupCapabilities(db, "campaign_caps", "collector_caps", writeFlags), true);
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canViewPickups: true,
    ...writeFlags,
  });
});

test("0012 defaults existing and new Collector rows to view=true", async () => {
  const db = database(false);
  applyMigration(db, visibilityMigration);
  assert.equal(db.raw.prepare("SELECT can_view_pickups FROM collection_collectors WHERE id = 'collector_caps'").get()?.can_view_pickups, 1);
  db.raw.prepare(
    `INSERT INTO collection_collectors
       (id, campaign_id, access_link_id, label, created_at, revoked_at)
     VALUES ('collector_caps_2', 'campaign_caps', 'collection_access_caps', 'Nutzer 2',
             '2026-08-31T00:01:00.000Z', NULL)`,
  ).run();
  assert.equal((await loadPickupCapabilities(db, "campaign_caps", "collector_caps_2"))?.canViewPickups, true);
});

test("view=false persists and atomically clears create edit and assign", async () => {
  const db = database(true);
  await updatePickupCapabilities(db, "campaign_caps", "collector_caps", {
    canViewPickups: true,
    canCreatePickups: true,
    canEditPickups: true,
    canAssignPickups: true,
  });
  await updatePickupCapabilities(db, "campaign_caps", "collector_caps", {
    canViewPickups: false,
    canCreatePickups: true,
    canEditPickups: true,
    canAssignPickups: true,
  });
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canViewPickups: false,
    canCreatePickups: false,
    canEditPickups: false,
    canAssignPickups: false,
  });
});

test("explicit view update is schema-gated while 0011-only write update still succeeds", async () => {
  const db = database(false);
  const cookie = await adminCookie(db);
  const gated = await handlePickupCapabilitiesApi(put(cookie, {
    canViewPickups: false,
    canCreatePickups: false,
    canEditPickups: false,
    canAssignPickups: false,
  }), db);
  assert.equal(gated?.status, 503);
  assert.equal(((await gated!.json()) as { error: { code: string } }).error.code, "pickup_visibility_schema_unavailable");

  const legacy = await handlePickupCapabilitiesApi(put(cookie, writeFlags), db);
  assert.equal(legacy?.status, 200);
  assert.deepEqual(((await legacy!.json()) as { capabilities: Record<string, boolean> }).capabilities, {
    canViewPickups: true,
    ...writeFlags,
  });
});

test("Collector cannot change own Pickup capabilities and foreign Campaign selector stays forbidden", async () => {
  const db = database(true);
  const collector = await collectorCookie(db);
  const self = await handlePickupCapabilitiesApi(put(collector, {
    canViewPickups: false,
    canCreatePickups: false,
    canEditPickups: false,
    canAssignPickups: false,
  }), db);
  assert.equal(self?.status, 403);

  const admin = await adminCookie(db);
  const foreign = await handlePickupCapabilitiesApi(put(
    admin,
    { canViewPickups: true, ...writeFlags },
    "https://flyer.test/api/campaigns/campaign_other/collection/collectors/collector_caps/pickup-capabilities",
  ), db);
  assert.equal(foreign?.status, 403);
});

test("access and admin list expose four capabilities without credential material", async () => {
  const db = database(true);
  await updatePickupCapabilities(db, "campaign_caps", "collector_caps", {
    canViewPickups: true,
    ...writeFlags,
  });
  const accessResponse = Response.json({
    access: {
      campaignId: "campaign_caps",
      role: "collection-collector",
      teamId: null,
      label: "Nutzer 1",
      collectorId: "collector_caps",
      collectionAccessId: "collection_access_caps",
    },
  }, { headers: { "set-cookie": "vf_collection_session=opaque; Path=/" } });
  const augmentedAccess = await augmentPickupCapabilitiesResponse(
    new Request("https://flyer.test/api/collection/access/redeem", { method: "POST" }),
    accessResponse,
    db,
  );
  assert.match(augmentedAccess.headers.get("set-cookie") ?? "", /vf_collection_session/u);
  const accessPayload = (await augmentedAccess.json()) as { access: { collectionCapabilities: Record<string, boolean> } };
  assert.deepEqual(accessPayload.access.collectionCapabilities, {
    canViewPickups: true,
    ...writeFlags,
  });

  const list = await augmentPickupCapabilitiesResponse(
    new Request("https://flyer.test/api/campaigns/campaign_caps/collection/collectors"),
    Response.json({ collectors: [{
      id: "collector_caps",
      campaignId: "campaign_caps",
      accessLinkId: "collection_access_caps",
      label: "Nutzer 1",
      createdAt: "2026-08-31T00:00:00.000Z",
      revokedAt: null,
    }] }),
    db,
  );
  const serialized = JSON.stringify(await list.json());
  assert.match(serialized, /"canViewPickups":true/u);
  assert.match(serialized, /"canCreatePickups":true/u);
  assert.match(serialized, /"canEditPickups":false/u);
  assert.match(serialized, /"canAssignPickups":true/u);
  assert.doesNotMatch(serialized, /session_hash|token_hash|sessionSecret|tokenHash/u);
});

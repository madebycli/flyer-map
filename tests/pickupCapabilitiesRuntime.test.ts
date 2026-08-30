import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { hashSecret } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
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
  for (const file of migrationFiles) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const stamp = "2026-08-30T20:00:00.000Z";
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
  return db;
}

async function adminCookie(db: SqliteD1) {
  const secret = "pickup-capability-admin-session";
  const stamp = "2026-08-30T20:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_caps_admin', 'campaign_caps', 'admin', NULL, 'token-hash', 'Admin', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
     VALUES ('session_caps_admin', 'grant_caps_admin', 'campaign_caps', ?, ?,
             '2099-01-01T00:00:00.000Z')`,
  ).run(await hashSecret(secret), stamp);
  return `vf_session=${encodeURIComponent(secret)}`;
}

const capabilityUrl =
  "https://flyer.test/api/campaigns/campaign_caps/collection/collectors/collector_caps/pickup-capabilities";

test("Pickup capabilities default deny and update atomically", async () => {
  const db = database();
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canCreatePickups: false,
    canEditPickups: false,
    canAssignPickups: false,
  });

  assert.equal(
    await updatePickupCapabilities(db, "campaign_caps", "collector_caps", {
      canCreatePickups: true,
      canEditPickups: true,
      canAssignPickups: false,
    }),
    true,
  );
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canCreatePickups: true,
    canEditPickups: true,
    canAssignPickups: false,
  });
});

test("Pickup capability API is admin-only and validates all three booleans", async () => {
  const db = database();
  const anonymous = await handlePickupCapabilitiesApi(
    new Request(capabilityUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        canCreatePickups: true,
        canEditPickups: false,
        canAssignPickups: false,
      }),
    }),
    db,
  );
  assert.equal(anonymous?.status, 403);

  const cookie = await adminCookie(db);
  const invalid = await handlePickupCapabilitiesApi(
    new Request(capabilityUrl, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ canCreatePickups: true }),
    }),
    db,
  );
  assert.equal(invalid?.status, 422);

  const response = await handlePickupCapabilitiesApi(
    new Request(capabilityUrl, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        canCreatePickups: true,
        canEditPickups: false,
        canAssignPickups: true,
      }),
    }),
    db,
  );
  assert.equal(response?.status, 200);
  assert.deepEqual(await loadPickupCapabilities(db, "campaign_caps", "collector_caps"), {
    canCreatePickups: true,
    canEditPickups: false,
    canAssignPickups: true,
  });
});

test("successful collector access and collector list responses are augmented without losing headers", async () => {
  const db = database();
  await updatePickupCapabilities(db, "campaign_caps", "collector_caps", {
    canCreatePickups: true,
    canEditPickups: false,
    canAssignPickups: true,
  });

  const accessResponse = Response.json(
    {
      access: {
        campaignId: "campaign_caps",
        role: "collection-collector",
        teamId: null,
        label: "Nutzer 1",
        collectorId: "collector_caps",
        collectionAccessId: "collection_access_caps",
      },
    },
    { headers: { "set-cookie": "vf_collection_session=secret; Path=/" } },
  );
  const augmentedAccess = await augmentPickupCapabilitiesResponse(
    new Request("https://flyer.test/api/collection/access/redeem", { method: "POST" }),
    accessResponse,
    db,
  );
  assert.match(augmentedAccess.headers.get("set-cookie") ?? "", /vf_collection_session/u);
  const accessPayload = (await augmentedAccess.json()) as {
    access: { collectionCapabilities: Record<string, boolean> };
  };
  assert.deepEqual(accessPayload.access.collectionCapabilities, {
    canCreatePickups: true,
    canEditPickups: false,
    canAssignPickups: true,
  });

  const listResponse = Response.json({
    collectors: [{
      id: "collector_caps",
      campaignId: "campaign_caps",
      accessLinkId: "collection_access_caps",
      label: "Nutzer 1",
      createdAt: "2026-08-30T20:00:00.000Z",
      revokedAt: null,
    }],
  });
  const augmentedList = await augmentPickupCapabilitiesResponse(
    new Request("https://flyer.test/api/campaigns/campaign_caps/collection/collectors"),
    listResponse,
    db,
  );
  const listPayload = (await augmentedList.json()) as {
    collectors: Array<{ collectionCapabilities: Record<string, boolean> }>;
  };
  assert.deepEqual(listPayload.collectors[0].collectionCapabilities, {
    canCreatePickups: true,
    canEditPickups: false,
    canAssignPickups: true,
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  createCollectionAccessLink,
  redeemCollectionAccess,
} from "../worker/collectionAccess.ts";
import { hashSecret } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  handlePickupSearch,
  parsePickupSearchPolygon,
  pickupSearchPointInPolygon,
} from "../worker/pickupSearch.ts";

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

const mainPolygon = {
  type: "Polygon",
  coordinates: [[
    [10, 50],
    [10.1, 50],
    [10.1, 50.1],
    [10, 50.1],
    [10, 50],
  ]],
} as const;

function database(includeMainArea = true) {
  const db = new SqliteD1();
  for (const file of migrationFiles) {
    db.raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const stamp = "2026-08-30T20:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at)
     VALUES ('campaign_search', 'Search', 'active', 0, 'write-token', ?, ?)`,
  ).run(stamp, stamp);
  if (includeMainArea) {
    db.raw.prepare(
      `INSERT INTO collection_main_areas
         (id, campaign_id, name, geometry_json, created_at, updated_at)
       VALUES ('collection_main_search', 'campaign_search', 'Main', ?, ?, ?)`,
    ).run(JSON.stringify(mainPolygon), stamp, stamp);
  }
  return db;
}

async function adminCookie(db: SqliteD1) {
  const secret = "pickup-search-admin-session";
  const stamp = "2026-08-30T20:00:00.000Z";
  db.raw.prepare(
    `INSERT INTO campaign_access_grants
       (id, campaign_id, role, team_id, token_hash, label, created_at, revoked_at)
     VALUES ('grant_search_admin', 'campaign_search', 'admin', NULL,
             'pickup-search-token-hash', 'Admin', ?, NULL)`,
  ).run(stamp);
  db.raw.prepare(
    `INSERT INTO campaign_sessions
       (id, grant_id, campaign_id, session_hash, created_at, expires_at)
     VALUES ('session_search_admin', 'grant_search_admin', 'campaign_search', ?, ?,
             '2099-01-01T00:00:00.000Z')`,
  ).run(await hashSecret(secret), stamp);
  return `vf_session=${encodeURIComponent(secret)}`;
}

function request(cookie: string | null, suffix = "?q=Haupt&lng=10.02&lat=50.02") {
  return new Request(
    `https://flyer.test/api/campaigns/campaign_search/collection/pickup-search${suffix}`,
    { headers: cookie ? { cookie } : {} },
  );
}

function limiter(success = true) {
  const keys: string[] = [];
  return {
    keys,
    binding: {
      async limit(input: { key: string }) {
        keys.push(input.key);
        return { success };
      },
    },
  };
}

test("Pickup search polygon parsing and containment include the boundary and reject outside points", () => {
  const ring = parsePickupSearchPolygon(mainPolygon);
  assert.ok(ring);
  assert.equal(pickupSearchPointInPolygon([10.05, 50.05], ring), true);
  assert.equal(pickupSearchPointInPolygon([10, 50.04], ring), true);
  assert.equal(pickupSearchPointInPolygon([10.2, 50.05], ring), false);
  assert.equal(parsePickupSearchPolygon({ type: "Polygon", coordinates: [] }), null);
});

test("Admin Pickup search keeps the key server-side and filters Geoapify results against the real polygon", async () => {
  const db = database();
  const cookie = await adminCookie(db);
  const rate = limiter();
  let upstreamUrl: URL | null = null;
  const fetchImpl: typeof fetch = async (input) => {
    upstreamUrl = new URL(String(input));
    return Response.json({
      results: [
        {
          place_id: "inside-one",
          osm_type: "node",
          osm_id: 123,
          address_line1: "Hauptstraße 1",
          formatted: "Hauptstraße 1, 12345 Teststadt, Deutschland",
          lon: 10.03,
          lat: 50.03,
          rawSecret: "must-not-leak",
        },
        {
          place_id: "outside-one",
          address_line1: "Außerhalb 9",
          formatted: "Außerhalb 9, Fremdstadt",
          lon: 10.2,
          lat: 50.03,
        },
      ],
    });
  };

  const response = await handlePickupSearch(
    request(cookie),
    {
      DB: db,
      GEOAPIFY_API_KEY: "server-secret-key",
      PICKUP_SEARCH_LIMITER: rate.binding,
    },
    { fetchImpl },
  );
  assert.equal(response?.status, 200);
  assert.ok(upstreamUrl);
  assert.equal(upstreamUrl.searchParams.get("text"), "Haupt");
  assert.equal(upstreamUrl.searchParams.get("format"), "json");
  assert.equal(upstreamUrl.searchParams.get("lang"), "de");
  assert.equal(upstreamUrl.searchParams.get("limit"), "8");
  assert.equal(upstreamUrl.searchParams.get("filter"), "rect:10,50,10.1,50.1");
  assert.equal(upstreamUrl.searchParams.get("bias"), "proximity:10.02,50.02");
  assert.equal(upstreamUrl.searchParams.get("apiKey"), "server-secret-key");
  assert.deepEqual(rate.keys, [
    "pickup-search:geoapify",
    "pickup-search:campaign_search:grant_search_admin",
  ]);

  const payload = (await response!.json()) as {
    results: Array<Record<string, unknown>>;
    attribution: Record<string, unknown>;
  };
  assert.equal(payload.results.length, 1);
  assert.deepEqual(payload.results[0], {
    id: "geoapify:inside-one",
    title: "Hauptstraße 1",
    address: "Hauptstraße 1, 12345 Teststadt, Deutschland",
    position: [10.03, 50.03],
    source: {
      kind: "osm-address",
      provider: "geoapify",
      placeId: "inside-one",
      osmType: "node",
      osmId: "123",
    },
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /server-secret-key|must-not-leak/u);
  assert.match(serialized, /Powered by Geoapify/u);
  assert.match(serialized, /OpenStreetMap contributors/u);
});

test("Pickup search requires access and Collector create capability before any provider request", async () => {
  const db = database();
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    providerCalls += 1;
    return Response.json({ results: [] });
  };
  const rate = limiter();
  const env = {
    DB: db,
    GEOAPIFY_API_KEY: "server-secret-key",
    PICKUP_SEARCH_LIMITER: rate.binding,
  };

  const anonymous = await handlePickupSearch(request(null), env, { fetchImpl });
  assert.equal(anonymous?.status, 401);
  assert.equal(providerCalls, 0);
  assert.equal(rate.keys.length, 0);

  const link = await createCollectionAccessLink(db, "campaign_search");
  const redeemed = await redeemCollectionAccess(db, "campaign_search", link.token);
  assert.ok(redeemed);
  const collectorCookie = `vf_collection_session=${encodeURIComponent(redeemed.sessionSecret)}`;

  const denied = await handlePickupSearch(request(collectorCookie), env, { fetchImpl });
  assert.equal(denied?.status, 403);
  const deniedPayload = (await denied!.json()) as { error: { code: string } };
  assert.equal(deniedPayload.error.code, "pickup_capability_forbidden");
  assert.equal(providerCalls, 0);
  assert.equal(rate.keys.length, 0);

  db.raw.prepare(
    "UPDATE collection_collectors SET can_create_pickups = 1 WHERE id = ?",
  ).run(redeemed.access.collectorId);
  const allowed = await handlePickupSearch(request(collectorCookie), env, { fetchImpl });
  assert.equal(allowed?.status, 200);
  assert.equal(providerCalls, 1);
  assert.deepEqual(rate.keys, [
    "pickup-search:geoapify",
    `pickup-search:campaign_search:${redeemed.access.collectorId}`,
  ]);
});

test("Pickup search fails closed for rate limits and missing Main Area without calling Geoapify", async () => {
  const db = database();
  const cookie = await adminCookie(db);
  let providerCalls = 0;
  const fetchImpl: typeof fetch = async () => {
    providerCalls += 1;
    return Response.json({ results: [] });
  };
  const blocked = limiter(false);
  const rateLimited = await handlePickupSearch(
    request(cookie),
    {
      DB: db,
      GEOAPIFY_API_KEY: "server-secret-key",
      PICKUP_SEARCH_LIMITER: blocked.binding,
    },
    { fetchImpl },
  );
  assert.equal(rateLimited?.status, 429);
  assert.equal(providerCalls, 0);

  const noMainDb = database(false);
  const noMainCookie = await adminCookie(noMainDb);
  const allowedRate = limiter();
  const noMain = await handlePickupSearch(
    request(noMainCookie),
    {
      DB: noMainDb,
      GEOAPIFY_API_KEY: "server-secret-key",
      PICKUP_SEARCH_LIMITER: allowedRate.binding,
    },
    { fetchImpl },
  );
  assert.equal(noMain?.status, 409);
  assert.equal(providerCalls, 0);
  assert.equal(allowedRate.keys.length, 0);
});

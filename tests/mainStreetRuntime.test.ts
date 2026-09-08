import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import mainWorker from "../worker/indexOrganizer.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly query: string,
    private readonly sqlite: DatabaseSync,
  ) {}

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

class SharedD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations).filter((entry) => /^\d{4}_.+\.sql$/u.test(entry)).sort()) {
      this.sqlite.exec(readFileSync(new URL(name, migrations), "utf8"));
    }
  }

  prepare(query: string) {
    return new Statement(query, this.sqlite);
  }

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

const campaignId = "campaign_main-street-runtime";
const areaId = "area_main-street-runtime";
const taskId = "task_main-street-runtime";
const sessionSecret = "session-main-street-runtime";
const origin = "https://main.flyer.test";
const time = "2026-09-08T10:00:00.000Z";

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function fixture() {
  const db = new SharedD1();
  db.sqlite.prepare(
    "INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_main_street','Main Street Organization',?,?)",
  ).run(time, time);
  db.sqlite.prepare(
    "INSERT INTO organization_accounts(id,username,username_normalized,created_at,updated_at) VALUES('account_main_street','master','master',?,?)",
  ).run(time, time);
  db.sqlite.prepare(
    "INSERT INTO organization_memberships(id,organization_id,account_id,role_kind,capabilities_json,created_at,updated_at) VALUES('membership_main_street','org_main_street','account_main_street','organizer','[]',?,?)",
  ).run(time, time);
  db.sqlite.prepare(
    "INSERT INTO organization_account_sessions(id,account_id,session_hash,assurance,created_at,expires_at) VALUES('session_main_street','account_main_street',?,'mfa',?,?)",
  ).run(await hash(sessionSecret), time, "2030-01-01T00:00:00.000Z");
  db.sqlite.prepare(
    "INSERT INTO campaigns(id,name,status,revision,write_token,organization_id,admin_lifecycle_status,created_at,updated_at) VALUES(?, 'Main Street Runtime', 'active', 1, 'seed', 'org_main_street', 'active', ?, ?)",
  ).run(campaignId, time, time);
  db.sqlite.prepare(
    "INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_main_street',?,'Street Team','#2563eb',?,?)",
  ).run(campaignId, time, time);
  db.sqlite.prepare(
    "INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES(? ,?,'team_main_street','Street Area',?,?,?)",
  ).run(
    areaId,
    campaignId,
    JSON.stringify({
      type: "Polygon",
      coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]],
    }),
    time,
    time,
  );
  db.sqlite.prepare(
    "INSERT INTO tasks(id,campaign_id,area_id,task_type,label,geometry_json,status,created_at,updated_at) VALUES(?,?,?,'street','Runtime Street',?,'open',?,?)",
  ).run(
    taskId,
    campaignId,
    areaId,
    JSON.stringify({ type: "LineString", coordinates: [[13.001, 51.005], [13.009, 51.005]] }),
    time,
    time,
  );
  return db;
}

const sessionCookie = `__Host-vf_organization_session=${sessionSecret}`;

function runtimeEnv(DB: SharedD1, assetFetch?: (request: Request) => Promise<Response>) {
  return {
    DB,
    ASSETS: {
      fetch: assetFetch ?? (async () => new Response("<!doctype html><div id=\"root\"></div>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })),
    },
  } as never;
}

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", sessionCookie);
  return new Request(`${origin}${path}`, { ...init, headers });
}

test("indexOrganizer keeps the complete FC52 server and MapLibre client composition chain", async () => {
  const [organizer, fc52, m55, core, mainEntry, platformShell, app, mapView, packageJson] = await Promise.all([
    readFile(new URL("../worker/indexOrganizer.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/indexFc52.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/indexM55.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/map/MapView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(organizer, /import baseWorker from "\.\/indexFc52\.ts";/u);
  assert.match(organizer, /const baseResponse = await baseWorker\.fetch\(request, env, context\);/u);
  assert.match(fc52, /import baseWorker from "\.\/indexM55\.ts";/u);
  assert.match(fc52, /let response = await baseWorker\.fetch\(request, env, context\);/u);
  assert.match(m55, /import baseWorker, \{ legacySnapshotWriteResponse \} from "\.\/index\.ts";/u);
  assert.match(m55, /return baseWorker\.fetch\(request, env, context\);/u);

  assert.match(core, /handleCampaignMutation/u);
  assert.match(core, /handleAreaTaskPreparationApi/u);
  assert.match(core, /handleRxdbCheckpoint/u);
  assert.match(core, /handleRxdbPull/u);
  assert.match(core, /handleRxdbPush/u);
  assert.match(core, /notifyCampaignSync/u);

  assert.match(mainEntry, /<PlatformShell \/>/u);
  assert.match(mainEntry, /installRxdbFetchGuard\(\);/u);
  assert.match(mainEntry, /<SyncStatus \/>/u);
  assert.match(platformShell, /import App from "\.\.\/App";/u);
  assert.match(platformShell, /import \{ StreetsHub \} from "\.\.\/streets\/StreetsHub\.tsx";/u);
  assert.match(app, /import \{ MapView, type MapCameraCommand \} from "\.\/map\/MapView";/u);
  assert.match(app, /type MapMode =[\s\S]*"street-draw"/u);
  assert.match(app, /type Area,/u);
  assert.match(app, /type DistributionTask,/u);
  assert.match(mapView, /from "maplibre-gl";/u);
  assert.match(mapView, /type AreaFeatureCollection/u);
  assert.match(mapView, /type StreetFeatureCollection/u);

  const pkg = JSON.parse(packageJson) as { dependencies?: Record<string, string> };
  assert.equal(pkg.dependencies?.["maplibre-gl"], "5.7.1");
  assert.equal(pkg.dependencies?.rxdb, "17.5.0");
});

test("Organizer root routing still hands Campaign URLs to the FC52 asset runtime", async () => {
  const db = await fixture();
  const seen: string[] = [];
  const response = await mainWorker.fetch(
    request(`/?campaign=${campaignId}`),
    runtimeEnv(db, async (assetRequest) => {
      seen.push(assetRequest.url);
      return new Response("MAPLIBRE_STREET_APP", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "MAPLIBRE_STREET_APP");
  assert.deepEqual(seen, [`${origin}/?campaign=${campaignId}`]);
  assert.equal(response.headers.get("location"), null);
});

test("Organizer wrapper preserves Street, Area, Task mutation and RxDB sync behavior", async () => {
  const db = await fixture();
  const env = runtimeEnv(db);

  const initial = await mainWorker.fetch(
    request(`/api/campaigns/${campaignId}/snapshot`),
    env,
  );
  assert.equal(initial.status, 200, await initial.clone().text());
  const initialSnapshot = await initial.json() as {
    revision: number;
    areas: Array<{ id: string; geometry: { type: string } }>;
    tasks: Array<{
      id: string;
      taskType: string;
      status: string;
      updatedAt: string;
      geometry: { type: string };
    }>;
  };
  assert.equal(initialSnapshot.areas[0]?.id, areaId);
  assert.equal(initialSnapshot.areas[0]?.geometry.type, "Polygon");
  assert.equal(initialSnapshot.tasks[0]?.id, taskId);
  assert.equal(initialSnapshot.tasks[0]?.taskType, "street");
  assert.equal(initialSnapshot.tasks[0]?.geometry.type, "LineString");

  const preparation = await mainWorker.fetch(
    request(`/api/campaigns/${campaignId}/areas/${areaId}/preparation`),
    env,
  );
  assert.notEqual(preparation.status, 404, await preparation.clone().text());
  assert.match(preparation.headers.get("content-type") ?? "", /application\/json/u);

  const mutationTime = "2026-09-08T10:01:00.000Z";
  const mutation = await mainWorker.fetch(
    request(`/api/campaigns/${campaignId}/mutations`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        mutation: {
          id: "mutation_main_street_runtime",
          campaignId,
          baseRevision: initialSnapshot.revision,
          createdAt: mutationTime,
          type: "task.set-status",
          payload: {
            taskId,
            status: "completed",
            completedAt: mutationTime,
            expectedUpdatedAt: initialSnapshot.tasks[0]?.updatedAt,
          },
        },
      }),
    }),
    env,
  );
  assert.equal(mutation.status, 200, await mutation.clone().text());

  const changed = await mainWorker.fetch(
    request(`/api/campaigns/${campaignId}/snapshot`),
    env,
  );
  assert.equal(changed.status, 200, await changed.clone().text());
  const changedSnapshot = await changed.json() as {
    tasks: Array<{ id: string; status: string }>;
  };
  assert.equal(changedSnapshot.tasks.find((task) => task.id === taskId)?.status, "completed");

  const checkpoint = await mainWorker.fetch(
    request(`/api/campaigns/${campaignId}/rxdb/checkpoint`),
    env,
  );
  assert.equal(checkpoint.status, 200, await checkpoint.clone().text());
  assert.match(checkpoint.headers.get("content-type") ?? "", /application\/json/u);

  const syncRows = db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ?",
  ).get(campaignId) as { count: number };
  assert.ok(syncRows.count >= 1);
});

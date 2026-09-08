import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import mainWorker from "../worker/indexOrganizer.ts";
import { organizationAccountSessionCookie } from "../worker/organizationAuth.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";

class Statement implements D1PreparedStatement {
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

class SharedD1 implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = new URL("../migrations/", import.meta.url);
    for (const name of readdirSync(migrations).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort()) {
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

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const db = new SharedD1();
  const time = "2026-09-08T00:00:00.000Z";
  db.sqlite.prepare("INSERT INTO organizations(id,name,created_at,updated_at) VALUES('org_shared','Shared Organization',?,?)").run(time, time);
  db.sqlite.prepare("INSERT INTO organization_accounts(id,username,username_normalized,created_at,updated_at) VALUES('account_shared','master','master',?,?)").run(time, time);
  db.sqlite.prepare("INSERT INTO organization_memberships(id,organization_id,account_id,role_kind,capabilities_json,created_at,updated_at) VALUES('membership_shared','org_shared','account_shared','organizer','[]',?,?)").run(time, time);

  const sessions = {
    one: "session-origin-one",
    two: "session-origin-two",
  } as const;
  for (const [origin, secret] of Object.entries(sessions)) {
    db.sqlite.prepare("INSERT INTO organization_account_sessions(id,account_id,session_hash,assurance,created_at,expires_at) VALUES(?, 'account_shared', ?, 'mfa', ?, ?)")
      .run(`session_${origin}`, await hash(secret), time, "2030-01-01T00:00:00.000Z");
  }

  db.sqlite.prepare("INSERT INTO campaigns(id,name,status,revision,write_token,organization_id,admin_lifecycle_status,created_at,updated_at) VALUES('campaign_shared','Shared Campaign','active',1,'seed','org_shared','active',?,?)").run(time, time);
  db.sqlite.prepare("INSERT INTO teams(id,campaign_id,name,color,created_at,updated_at) VALUES('team_shared','campaign_shared','Team','#2563eb',?,?)").run(time, time);
  const area = JSON.stringify({ type: "Polygon", coordinates: [[[13, 51], [13.01, 51], [13.01, 51.01], [13, 51.01], [13, 51]]] });
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_shared','campaign_shared','team_shared','Area',?,?,?)").run(area, time, time);
  const road = JSON.stringify({ type: "LineString", coordinates: [[13.001, 51.005], [13.009, 51.005]] });
  db.sqlite.prepare("INSERT INTO tasks(id,campaign_id,area_id,task_type,label,geometry_json,status,created_at,updated_at) VALUES('task_shared','campaign_shared','area_shared','street','Road',?,'open',?,?)").run(road, time, time);

  return { db, sessions, time };
}

const env = (DB: SharedD1) => ({
  DB,
  ASSETS: {
    fetch: async () => new Response("<!doctype html><main>Organizer Login</main>", { headers: { "content-type": "text/html" } }),
  },
}) as never;

function sessionCookieHeader(secret: string) {
  return organizationAccountSessionCookie(secret).split(";", 1)[0];
}

function request(origin: string, path: string, secret?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (secret) headers.set("cookie", sessionCookieHeader(secret));
  return new Request(origin + path, { ...init, headers });
}

type PullBody = {
  documents: Array<{
    id: string;
    campaignId: string;
    status: string;
    completedAt: string | null;
    updatedAt: string;
  }>;
  checkpoint: { seq: number };
  campaignRevision: number;
};

async function pull(db: SharedD1, origin: string, secret: string, checkpoint: { seq: number } | null) {
  const response = await mainWorker.fetch(request(origin, "/api/campaigns/campaign_shared/rxdb/pull/streetTasks", secret, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ checkpoint, batchSize: 100 }),
  }), env(db));
  assert.equal(response.status, 200, await response.clone().text());
  return response.json() as Promise<PullBody>;
}

async function mutate(
  db: SharedD1,
  origin: string,
  secret: string,
  id: string,
  status: "completed" | "later",
  baseRevision: number,
  expectedUpdatedAt: string,
  createdAt: string,
) {
  const response = await mainWorker.fetch(request(origin, "/api/campaigns/campaign_shared/mutations", secret, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      mutation: {
        id,
        campaignId: "campaign_shared",
        baseRevision,
        createdAt,
        type: "task.set-status",
        payload: {
          taskId: "task_shared",
          status,
          completedAt: status === "completed" ? createdAt : null,
          expectedUpdatedAt,
        },
      },
    }),
  }), env(db));
  assert.equal(response.status, 200, await response.clone().text());
}

test("Organization session cookies keep the __Host host-only contract", () => {
  const cookie = organizationAccountSessionCookie("origin-local-secret");
  assert.match(cookie, /^__Host-vf_organization_session=/u);
  assert.match(cookie, /; Path=\//u);
  assert.match(cookie, /; HttpOnly/u);
  assert.match(cookie, /; Secure/u);
  assert.match(cookie, /; SameSite=Lax/u);
  assert.equal(/;\s*Domain=/iu.test(cookie), false);
});

test("two origins keep distinct __Host sessions while sharing Organization, Campaign, D1 and RxDB changes", async () => {
  const { db, sessions, time } = await fixture();
  const one = "https://one.flyer.test";
  const two = "https://two.flyer.test";

  assert.notEqual(sessionCookieHeader(sessions.one), sessionCookieHeader(sessions.two));

  const meOneResponse = await mainWorker.fetch(request(one, "/api/organization/me", sessions.one), env(db));
  const meTwoResponse = await mainWorker.fetch(request(two, "/api/organization/me", sessions.two), env(db));
  assert.equal(meOneResponse.status, 200, await meOneResponse.clone().text());
  assert.equal(meTwoResponse.status, 200, await meTwoResponse.clone().text());
  assert.deepEqual(await meTwoResponse.json(), await meOneResponse.json());

  const initialOne = await pull(db, one, sessions.one, null);
  const initialTwo = await pull(db, two, sessions.two, null);
  assert.deepEqual(initialTwo, initialOne);
  assert.deepEqual(initialOne.documents.map(({ id, campaignId, status }) => ({ id, campaignId, status })), [
    { id: "task_shared", campaignId: "campaign_shared", status: "open" },
  ]);

  await mutate(db, one, sessions.one, "mutation_from_one", "completed", 1, time, "2026-09-08T00:01:00.000Z");

  const afterOneOnOne = await pull(db, one, sessions.one, initialOne.checkpoint);
  const afterOneOnTwo = await pull(db, two, sessions.two, initialTwo.checkpoint);
  assert.deepEqual(afterOneOnTwo, afterOneOnOne);
  assert.equal(afterOneOnTwo.documents.at(-1)?.status, "completed");
  assert.ok(afterOneOnTwo.checkpoint.seq > initialTwo.checkpoint.seq);
  assert.equal(afterOneOnTwo.campaignRevision, 2);

  const completed = afterOneOnTwo.documents.at(-1);
  assert.ok(completed);
  await mutate(
    db,
    two,
    sessions.two,
    "mutation_from_two",
    "later",
    afterOneOnTwo.campaignRevision,
    completed.updatedAt,
    "2026-09-08T00:02:00.000Z",
  );

  const afterTwoOnOne = await pull(db, one, sessions.one, afterOneOnOne.checkpoint);
  const afterTwoOnTwo = await pull(db, two, sessions.two, afterOneOnTwo.checkpoint);
  assert.deepEqual(afterTwoOnTwo, afterTwoOnOne);
  assert.equal(afterTwoOnOne.documents.at(-1)?.status, "later");
  assert.ok(afterTwoOnOne.checkpoint.seq > afterOneOnOne.checkpoint.seq);
  assert.equal(afterTwoOnOne.campaignRevision, 3);

  const forged = await mainWorker.fetch(request(two, "/api/campaigns/campaign_shared/rxdb/pull/streetTasks", sessions.two, {
    method: "POST",
    headers: { origin: one, "content-type": "application/json" },
    body: JSON.stringify({ checkpoint: afterTwoOnTwo.checkpoint, batchSize: 100 }),
  }), env(db));
  assert.equal(forged.status, 403);

  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM organizations WHERE id='org_shared'").get()!.n, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM campaigns WHERE id='campaign_shared' AND organization_id='org_shared'").get()!.n, 1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM organization_account_sessions WHERE account_id='account_shared'").get()!.n, 2);
  assert.equal(db.sqlite.prepare("SELECT count(DISTINCT campaign_id) AS n FROM campaign_sync_changes").get()!.n, 1);
});

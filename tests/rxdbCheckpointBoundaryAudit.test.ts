import assert from "node:assert/strict";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement } from "../worker/campaignRepository.ts";
import { handleRxdbPull } from "../worker/rxdbSync.ts";

const campaignId = "campaign_checkpoint_audit";
const schemaColumns = [
  "seq",
  "campaign_id",
  "collection_name",
  "document_id",
  "operation",
  "scope_team_id",
  "document_json",
  "changed_at",
];

const admin: AccessContext = {
  grantId: "grant_checkpoint_admin",
  campaignId,
  role: "admin",
  teamId: null,
  label: "Audit Admin",
};

class AuditStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(readonly query: string, private readonly db: AuditDb) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("MAX(seq)")) return { seq: this.db.highWater } as T;
    if (this.query.includes("SELECT revision FROM campaigns")) return { revision: this.db.revision } as T;
    return null;
  }

  async all<T>() {
    if (this.query.includes("PRAGMA table_info(campaign_sync_changes)")) {
      return { results: schemaColumns.map((name) => ({ name })) as T[] };
    }
    if (this.query.includes("FROM campaign_sync_changes")) {
      this.db.feedQueries.push({ query: this.query, values: [...this.values] });
      return { results: [] as T[] };
    }
    return { results: [] as T[] };
  }
}

class AuditDb implements D1DatabaseLike {
  highWater = 123;
  revision = 9;
  readonly prepared: string[] = [];
  readonly feedQueries: Array<{ query: string; values: unknown[] }> = [];

  prepare(query: string) {
    this.prepared.push(query);
    return new AuditStatement(query, this);
  }

  async batch() {
    throw new Error("pull boundary audit must never write");
  }
}

test("negative, fractional, unsafe, and malformed checkpoints fail closed", async () => {
  const invalidCheckpoints = [
    { seq: -1 },
    { seq: 1.5 },
    { seq: Number.MAX_SAFE_INTEGER + 1 },
    { seq: "12" },
    { seq: null },
    {},
    "12",
    [12],
  ];

  for (const checkpoint of invalidCheckpoints) {
    const db = new AuditDb();
    const response = await handleRxdbPull(db, campaignId, "streetTasks", admin, { checkpoint });
    assert.equal(response.status, 400, `checkpoint ${JSON.stringify(checkpoint)} must be rejected`);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "invalid_checkpoint");
    assert.equal(db.feedQueries.length, 0, "invalid checkpoints must not reach change-feed reads");
  }
});

test("oversized pull batch request is clamped to the server maximum of 250", async () => {
  const db = new AuditDb();
  const response = await handleRxdbPull(
    db,
    campaignId,
    "streetTasks",
    admin,
    { checkpoint: { seq: 10 }, batchSize: 100_000 },
  );
  assert.equal(response.status, 200);
  assert.equal(db.feedQueries.length, 1);
  assert.deepEqual(db.feedQueries[0].values, [campaignId, "streetTasks", 10, 123, 250]);
  const body = await response.json() as { checkpoint: { seq: number }; campaignRevision: number };
  assert.deepEqual(body.checkpoint, { seq: 123 });
  assert.equal(body.campaignRevision, 9);
});

test("zero and negative pull batch sizes are clamped to one", async () => {
  for (const requested of [0, -10]) {
    const db = new AuditDb();
    const response = await handleRxdbPull(
      db,
      campaignId,
      "streetTasks",
      admin,
      { checkpoint: { seq: 10 }, batchSize: requested },
    );
    assert.equal(response.status, 200);
    assert.equal(db.feedQueries.length, 1);
    assert.equal(db.feedQueries[0].values.at(-1), 1);
  }
});

test("field-group incremental pull is explicitly constrained by canonical team scope", async () => {
  const db = new AuditDb();
  const fieldGroup: AccessContext = {
    grantId: "field-group:membership_a",
    campaignId,
    role: "field-group-member",
    teamId: "team_a",
    label: "Group A",
    groupId: "group_a",
    membershipId: "membership_a",
  };
  const response = await handleRxdbPull(
    db,
    campaignId,
    "streetTasks",
    fieldGroup,
    { checkpoint: { seq: 10 }, batchSize: 25 },
  );
  assert.equal(response.status, 200);
  assert.equal(db.feedQueries.length, 1);
  assert.match(db.feedQueries[0].query, /scope_team_id = \?/u);
  assert.deepEqual(db.feedQueries[0].values, [campaignId, "streetTasks", 10, 123, "team_a", 25]);
});

test("campaign collection remains campaign-scoped instead of adding a team filter", async () => {
  const db = new AuditDb();
  const fieldGroup: AccessContext = {
    grantId: "field-group:membership_a",
    campaignId,
    role: "field-group-member",
    teamId: "team_a",
    label: "Group A",
    groupId: "group_a",
    membershipId: "membership_a",
  };
  const response = await handleRxdbPull(
    db,
    campaignId,
    "campaigns",
    fieldGroup,
    { checkpoint: { seq: 10 }, batchSize: 25 },
  );
  assert.equal(response.status, 200);
  assert.equal(db.feedQueries.length, 1);
  assert.doesNotMatch(db.feedQueries[0].query, /scope_team_id = \?/u);
  assert.deepEqual(db.feedQueries[0].values, [campaignId, "campaigns", 10, 123, 25]);
});

test.todo("checkpoint ahead of current D1 high-water requires an explicit safe-resync recovery contract");

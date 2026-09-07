import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import type { D1DatabaseLike, D1PreparedStatement, D1RunResult } from "../worker/campaignRepository.ts";
import type { RxdbChangeFeedEntry } from "../worker/rxdbChangeFeed.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";

const timestamp = "2026-09-07T13:17:00.000Z";

class Statement implements D1PreparedStatement {
  private values: unknown[] = [];

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

class AtomicAuditDb implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor() {
    for (const file of [
      "0001_initial.sql",
      "0003_m5_mutations.sql",
      "0004_m6_task_source_provenance.sql",
      "0005_m6_house_tasks.sql",
      "0014_auto_area_task_preparation.sql",
      "0017_rxdb_sync_changes.sql",
    ]) {
      this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
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

test("forced change-feed insert failure rolls back canonical mutation, revision, and ledger together", async () => {
  const db = new AtomicAuditDb();
  const campaignId = "campaign_atomic_fault";
  db.sqlite.prepare(
    "INSERT INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, 'Before', 'active', 7, 'original-token', ?, ?)",
  ).run(campaignId, timestamp, timestamp);

  db.sqlite.exec(`
    CREATE TRIGGER audit_fail_sync_feed
    BEFORE INSERT ON campaign_sync_changes
    BEGIN
      SELECT RAISE(ABORT, 'forced_feed_failure');
    END;
  `);

  const mutation: CampaignMutation = {
    id: "mutation_atomic_fault",
    campaignId,
    type: "campaign.rename",
    payload: { name: "After", expectedName: "Before" },
    baseRevision: 7,
    createdAt: "2026-09-07T13:18:00.000Z",
  };
  const syncChanges: RxdbChangeFeedEntry[] = [{
    collectionName: "campaigns",
    scopeTeamId: null,
    document: {
      id: campaignId,
      campaignId,
      name: "After",
      status: "active",
      defaultMapView: null,
      createdAt: timestamp,
      updatedAt: mutation.createdAt,
    },
  }];

  await assert.rejects(
    () => persistCampaignMutation(db, mutation, 7, undefined, null, null, syncChanges),
    /forced_feed_failure/u,
  );

  const campaign = db.sqlite.prepare(
    "SELECT name, revision, write_token, updated_at FROM campaigns WHERE id = ?",
  ).get(campaignId) as { name: string; revision: number; write_token: string; updated_at: string };
  assert.deepEqual(campaign, {
    name: "Before",
    revision: 7,
    write_token: "original-token",
    updated_at: timestamp,
  });

  const ledger = db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM campaign_mutations WHERE campaign_id = ?",
  ).get(campaignId) as { count: number };
  const feed = db.sqlite.prepare(
    "SELECT COUNT(*) AS count FROM campaign_sync_changes WHERE campaign_id = ?",
  ).get(campaignId) as { count: number };
  assert.equal(ledger.count, 0, "mutation ledger must roll back with the failed feed insert");
  assert.equal(feed.count, 0, "failed feed transaction must not leave partial change rows");
});

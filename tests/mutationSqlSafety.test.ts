import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

class CapturingStatement implements D1PreparedStatement {
  readonly query: string;
  values: unknown[] = [];
  private readonly database: CapturingDatabase;

  constructor(query: string, database: CapturingDatabase) {
    this.query = query;
    this.database = database;
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("FROM campaign_mutations")) return null;
    if (this.query.includes("SELECT revision FROM campaigns")) {
      return { revision: this.database.currentRevision } as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class CapturingDatabase implements D1DatabaseLike {
  currentRevision = 2;
  lastBatch: CapturingStatement[] = [];

  prepare(query: string) {
    return new CapturingStatement(query, this);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.lastBatch = statements as CapturingStatement[];
    this.currentRevision += 1;
    return this.lastBatch.map<D1RunResult>(() => ({
      success: true,
      meta: { changes: 1 },
    }));
  }
}

test("user-controlled mutation text is bound as inert D1 data", async () => {
  const db = new CapturingDatabase();
  const hostileName = "x'); DROP TABLE campaigns; -- <script>alert(1)</script>";
  const mutation: CampaignMutation = {
    id: "mutation_sql-safety",
    campaignId: "campaign_sql-safety",
    type: "campaign.rename",
    payload: { name: hostileName, expectedName: "Alt" },
    baseRevision: 2,
    createdAt: "2026-08-25T21:00:00.000Z",
  };

  const result = await persistCampaignMutation(db, mutation, 2);

  assert.deepEqual(result, { ok: true, revision: 3, alreadyApplied: false });
  assert.equal(db.lastBatch.length, 3);

  const mutationWrite = db.lastBatch[1];
  assert.equal(mutationWrite.query.includes(hostileName), false);
  assert.match(mutationWrite.query, /SET name = \?/);
  assert.equal(mutationWrite.values[0], hostileName);
});

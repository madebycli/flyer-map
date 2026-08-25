import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

class FakeStatement implements D1PreparedStatement {
  values: unknown[] = [];
  readonly query: string;
  private readonly database: FakeMutationDatabase;

  constructor(query: string, database: FakeMutationDatabase) {
    this.query = query;
    this.database = database;
  }

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("FROM campaign_mutations")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      const applied = this.database.ledger.get(key);
      return applied
        ? ({
            mutation_type: applied.type,
            mutation_fingerprint: applied.fingerprint,
            applied_revision: applied.revision,
          } as T)
        : null;
    }
    if (this.query.includes("SELECT revision FROM campaigns")) {
      return { revision: this.database.currentRevision } as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class FakeMutationDatabase implements D1DatabaseLike {
  currentRevision = 4;
  mutationApplications = 0;
  batchCalls = 0;
  ledger = new Map<
    string,
    { type: CampaignMutation["type"]; fingerprint: string; revision: number }
  >();

  prepare(query: string) {
    return new FakeStatement(query, this);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.batchCalls += 1;
    const typed = statements as FakeStatement[];
    const claim = typed[0];
    const expectedRevision = claim.values[4] as number;
    const nextRevision = claim.values[0] as number;
    const claimSucceeded = expectedRevision === this.currentRevision;

    if (claimSucceeded) {
      this.currentRevision = nextRevision;
      this.mutationApplications += 1;
      const ledger = typed[2];
      const campaignId = ledger.values[0] as string;
      const mutationId = ledger.values[1] as string;
      this.ledger.set(`${campaignId}:${mutationId}`, {
        type: ledger.values[2] as CampaignMutation["type"],
        fingerprint: ledger.values[3] as string,
        revision: ledger.values[6] as number,
      });
    }

    return typed.map<D1RunResult>((_, index) => ({
      success: true,
      meta: { changes: index === 0 && claimSucceeded ? 1 : claimSucceeded ? 1 : 0 },
    }));
  }
}

function mutation(): CampaignMutation {
  return {
    id: "mutation_idempotency-1",
    campaignId: "campaign_mutation-test",
    type: "campaign.rename",
    payload: { name: "Neu", expectedName: "Alt" },
    baseRevision: 4,
    createdAt: "2026-08-24T10:00:00.000Z",
  };
}

test("same mutation id and payload is applied server-side only once", async () => {
  const db = new FakeMutationDatabase();
  const input = mutation();

  const first = await persistCampaignMutation(db, input, 4);
  const second = await persistCampaignMutation(db, input, 5);

  assert.deepEqual(first, { ok: true, revision: 5, alreadyApplied: false });
  assert.deepEqual(second, { ok: true, revision: 5, alreadyApplied: true });
  assert.equal(db.mutationApplications, 1);
  assert.equal(db.batchCalls, 1);
});

test("same mutation id with changed payload is rejected instead of treated as duplicate", async () => {
  const db = new FakeMutationDatabase();
  const firstInput = mutation();
  const changedInput: CampaignMutation = {
    ...firstInput,
    payload: { name: "Anderer Inhalt", expectedName: "Alt" },
  };

  const first = await persistCampaignMutation(db, firstInput, 4);
  const reused = await persistCampaignMutation(db, changedInput, 5);

  assert.deepEqual(first, { ok: true, revision: 5, alreadyApplied: false });
  assert.deepEqual(reused, {
    ok: false,
    currentRevision: 5,
    reason: "mutation_id_reused",
  });
  assert.equal(db.mutationApplications, 1);
  assert.equal(db.batchCalls, 1);
});

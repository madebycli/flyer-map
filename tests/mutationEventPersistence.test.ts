import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import type { MutationDomainEvent } from "../worker/mutationEvents.ts";
import { persistCampaignMutation } from "../worker/mutationRepository.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: EventPersistenceDb,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.query.includes("FROM campaign_mutations")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      const applied = this.db.ledger.get(key);
      return applied
        ? ({
            mutation_type: applied.type,
            mutation_fingerprint: applied.fingerprint,
            applied_revision: applied.revision,
          } as T)
        : null;
    }
    if (this.query.includes("SELECT revision FROM campaigns")) {
      return { revision: this.db.currentRevision } as T;
    }
    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class EventPersistenceDb implements D1DatabaseLike {
  currentRevision = 4;
  batchCalls = 0;
  eventInserts = 0;
  eventStatement: Statement | null = null;
  ledger = new Map<
    string,
    { type: CampaignMutation["type"]; fingerprint: string; revision: number }
  >();

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.batchCalls += 1;
    const typed = statements as Statement[];
    const claim = typed[0];
    const expectedRevision = claim.values[4] as number;
    const nextRevision = claim.values[0] as number;
    const claimSucceeded = expectedRevision === this.currentRevision;

    if (claimSucceeded) {
      this.currentRevision = nextRevision;
      const ledger = typed[2];
      this.ledger.set(`${ledger.values[0]}:${ledger.values[1]}`, {
        type: ledger.values[2] as CampaignMutation["type"],
        fingerprint: ledger.values[3] as string,
        revision: ledger.values[6] as number,
      });
      if (typed[3]?.query.includes("INSERT OR IGNORE INTO domain_events")) {
        this.eventInserts += 1;
        this.eventStatement = typed[3];
      }
    }

    return typed.map<D1RunResult>((_, index) => ({
      success: true,
      meta: { changes: claimSucceeded ? (index === 0 ? 1 : 1) : 0 },
    }));
  }
}

function mutation(): CampaignMutation {
  return {
    id: "mutation_task_status_event",
    campaignId: "campaign_events",
    type: "task.set-status",
    payload: {
      taskId: "task_a",
      status: "completed",
      completedAt: "2026-08-27T10:30:00.000Z",
      expectedUpdatedAt: "2026-08-27T10:00:00.000Z",
    },
    baseRevision: 4,
    createdAt: "2026-08-27T10:30:00.000Z",
  };
}

function event(): MutationDomainEvent {
  return {
    teamId: "team_a",
    fieldSessionId: "field_session_a",
    entityType: "street-task",
    entityId: "task_a",
    eventType: "task.status.changed",
    occurredAt: "2026-08-27T10:30:00.000Z",
    actorKind: "campaign-grant",
    actorRef: "grant_editor",
    previousStatus: "open",
    newStatus: "completed",
  };
}

test("task status event is inserted in the same guarded M5 batch", async () => {
  const db = new EventPersistenceDb();
  const input = mutation();

  const result = await persistCampaignMutation(db, input, 4, undefined, event());

  assert.deepEqual(result, { ok: true, revision: 5, alreadyApplied: false });
  assert.equal(db.batchCalls, 1);
  assert.equal(db.eventInserts, 1);
  assert.match(db.eventStatement?.query ?? "", /INSERT OR IGNORE INTO domain_events/u);
  assert.match(
    db.eventStatement?.query ?? "",
    /EXISTS \(SELECT 1 FROM campaigns WHERE id = \? AND write_token = \?\)/u,
  );
  assert.equal(db.eventStatement?.values[0], `domain_event_mutation_${input.id}`);
  assert.equal(db.eventStatement?.values[3], "field_session_a");
  assert.equal(db.eventStatement?.values[6], "task.status.changed");
  assert.deepEqual(JSON.parse(String(db.eventStatement?.values[10])), {
    previousStatus: "open",
    newStatus: "completed",
  });
  assert.equal(
    db.eventStatement?.values[11],
    `campaign-mutation:${input.id}:task-status`,
  );
});

test("retrying an already applied mutation does not insert a second domain event", async () => {
  const db = new EventPersistenceDb();
  const input = mutation();

  const first = await persistCampaignMutation(db, input, 4, undefined, event());
  const replay = await persistCampaignMutation(db, input, 5, undefined, event());

  assert.deepEqual(first, { ok: true, revision: 5, alreadyApplied: false });
  assert.deepEqual(replay, { ok: true, revision: 5, alreadyApplied: true });
  assert.equal(db.batchCalls, 1);
  assert.equal(db.eventInserts, 1);
});

test("mutations without a domain event keep the original three-statement M5 batch", async () => {
  const db = new EventPersistenceDb();
  const rename: CampaignMutation = {
    id: "mutation_no_event",
    campaignId: "campaign_events",
    type: "campaign.rename",
    payload: { name: "Neu", expectedName: "Alt" },
    baseRevision: 4,
    createdAt: "2026-08-27T11:00:00.000Z",
  };

  const result = await persistCampaignMutation(db, rename, 4);

  assert.equal(result.ok, true);
  assert.equal(db.eventInserts, 0);
});

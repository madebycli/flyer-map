import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { expireOrganizationFieldGroups } from "../worker/organizationFieldGroupList.ts";

class ExpiryStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(readonly query: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return null as T | null;
  }

  async all<T>() {
    const normalized = this.query.replace(/\s+/gu, " ").trim();
    if (normalized.startsWith("SELECT id, team_id, hard_expires_at FROM field_groups")) {
      return {
        results: [
          {
            id: "group_expired",
            team_id: "team_a",
            hard_expires_at: "2000-01-01T00:00:00.000Z",
          } as T,
        ],
      };
    }
    return { results: [] as T[] };
  }
}

class ExpiryDb implements D1DatabaseLike {
  batches: ExpiryStatement[][] = [];

  prepare(query: string) {
    return new ExpiryStatement(query);
  }

  async batch(statements: D1PreparedStatement[]) {
    this.batches.push(statements as ExpiryStatement[]);
    return statements.map((_, index) => ({
      success: true,
      meta: { changes: index === 0 ? 1 : 0 },
    })) satisfies D1RunResult[];
  }
}

test("organizer room list expiry revokes joins and removes recoverable credentials", async () => {
  const db = new ExpiryDb();
  const now = "2026-09-06T00:00:00.000Z";
  const emitted: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => emitted.push(String(args[0] ?? ""));
  try {
    await expireOrganizationFieldGroups(db, "campaign_a", now);
  } finally {
    console.info = originalInfo;
  }

  assert.equal(db.batches.length, 1);
  const [groupUpdate, credentialRevoke, recoveryDelete] = db.batches[0];
  assert.ok(groupUpdate && credentialRevoke && recoveryDelete);
  assert.match(groupUpdate.query, /SET state = 'expired'/u);
  assert.deepEqual(groupUpdate.values, [now, "group_expired", "campaign_a", now]);
  assert.match(credentialRevoke.query, /SET revoked_at = COALESCE\(revoked_at, \?\)/u);
  assert.deepEqual(credentialRevoke.values, ["2000-01-01T00:00:00.000Z", "group_expired", "campaign_a"]);
  assert.match(recoveryDelete.query, /DELETE FROM field_group_recoverable_credentials/u);
  assert.deepEqual(recoveryDelete.values, ["group_expired", "campaign_a"]);

  assert.equal(emitted.length, 1);
  const audit = JSON.parse(emitted[0]) as Record<string, unknown>;
  assert.equal(audit.event, "field_group.expired");
  assert.equal(audit.campaignId, "campaign_a");
  assert.equal(audit.groupId, "group_expired");
  assert.equal(audit.actorKind, "system");
});

test("organization list handler executes expiry cleanup before reading active rooms", () => {
  const source = readFileSync(
    new URL("../worker/organizationFieldGroupList.ts", import.meta.url),
    "utf8",
  );
  const expiryIndex = source.indexOf("await expireOrganizationFieldGroups(env.DB, campaignId");
  const listIndex = source.indexOf("const groups = await listRows(env.DB, campaignId, scope)");
  assert.ok(expiryIndex >= 0);
  assert.ok(listIndex > expiryIndex);
});

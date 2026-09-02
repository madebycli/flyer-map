import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentAccessRole } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  handleFieldGroupMembersApi,
  parseFieldGroupMembersRoute,
} from "../worker/fieldGroupMembers.ts";

type Member = {
  id: string;
  campaignGrantId: string | null;
  joinedAt: string;
  expiresAt: string;
  leftAt: string | null;
  removedAt: string | null;
  grantLabel: string | null;
};

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: MemberDb,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (query.includes("FROM campaign_sessions s")) {
      const campaignId = this.values[2] as string | null;
      if (campaignId && campaignId !== "campaign_a") return null;
      return {
        grant_id: `grant_${this.db.role}`,
        campaign_id: "campaign_a",
        role: this.db.role,
        team_id: this.db.teamId,
        label: "Test access",
      } as T;
    }
    if (query.includes("SELECT team_id, state, hard_expires_at FROM field_groups")) {
      const [groupId, campaignId] = this.values as [string, string];
      if (groupId !== "group_a" || campaignId !== "campaign_a") return null;
      return {
        team_id: this.db.groupTeamId,
        state: this.db.groupState,
        hard_expires_at: this.db.hardExpiresAt,
      } as T;
    }
    return null;
  }

  async all<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (query.includes("FROM field_group_memberships m")) {
      const [, , now] = this.values as [string, string, string];
      return {
        results: this.db.members
          .filter(
            (member) =>
              !member.leftAt &&
              !member.removedAt &&
              member.expiresAt > now,
          )
          .map((member) => ({
            id: member.id,
            campaign_grant_id: member.campaignGrantId,
            joined_at: member.joinedAt,
            grant_label: member.grantLabel,
          })) as T[],
      };
    }
    return { results: [] as T[] };
  }
}

class MemberDb implements D1DatabaseLike {
  role: PersistentAccessRole = "admin";
  teamId: string | null = null;
  groupTeamId = "team_a";
  groupState: "active" | "closed" | "expired" = "active";
  hardExpiresAt = "2099-01-01T00:00:00.000Z";
  members: Member[] = [
    {
      id: "member_temp",
      campaignGrantId: null,
      joinedAt: "2026-08-27T10:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      leftAt: null,
      removedAt: null,
      grantLabel: null,
    },
    {
      id: "member_persistent",
      campaignGrantId: "grant_editor",
      joinedAt: "2026-08-27T10:05:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      leftAt: null,
      removedAt: null,
      grantLabel: "Nord-Team Gerät",
    },
    {
      id: "member_left",
      campaignGrantId: null,
      joinedAt: "2026-08-27T09:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      leftAt: "2026-08-27T09:30:00.000Z",
      removedAt: null,
      grantLabel: null,
    },
  ];

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    const results: D1RunResult[] = [];
    for (const statement of statements as Statement[]) {
      const query = statement.query.replace(/\s+/gu, " ");
      let changes = 0;
      if (query.includes("UPDATE field_groups") && this.groupState === "active") {
        this.groupState = "expired";
        changes = 1;
      } else if (query.includes("UPDATE field_group_join_credentials")) {
        changes = 1;
      }
      results.push({ success: true, meta: { changes } });
    }
    return results;
  }
}

function request(method = "GET") {
  return new Request(
    "https://flyer.test/api/campaigns/campaign_a/field-groups/group_a/memberships",
    {
      method,
      headers: { cookie: "vf_session=test-session" },
    },
  );
}

async function quietAudit<T>(run: () => Promise<T>) {
  const previous = console.info;
  console.info = () => undefined;
  try {
    return await run();
  } finally {
    console.info = previous;
  }
}

test("member roster route is exact and safely decoded", () => {
  assert.deepEqual(
    parseFieldGroupMembersRoute(
      "/api/campaigns/campaign_a/field-groups/group_a/memberships",
    ),
    { campaignId: "campaign_a", groupId: "group_a" },
  );
  assert.equal(
    parseFieldGroupMembersRoute(
      "/api/campaigns/campaign_a/field-groups/group_a/memberships/member_a",
    ),
    null,
  );
  assert.equal(
    parseFieldGroupMembersRoute(
      "/api/campaigns/%2F/field-groups/group_a/memberships",
    ),
    null,
  );
});

test("admin roster returns only active minimal membership metadata", async () => {
  const db = new MemberDb();
  const response = await handleFieldGroupMembersApi(request(), db);
  assert.equal(response?.status, 200);
  const body = await response?.json();
  assert.deepEqual(body.members, [
    {
      id: "member_temp",
      kind: "temporary",
      label: "Temporäres Mitglied",
      joinedAt: "2026-08-27T10:00:00.000Z",
    },
    {
      id: "member_persistent",
      kind: "campaign-access",
      label: "Nord-Team Gerät",
      joinedAt: "2026-08-27T10:05:00.000Z",
    },
  ]);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /session|secret|hash|room|qr|ip/iu);
});

test("own Team Editor can list members but foreign Team Editor and Viewer cannot", async () => {
  const own = new MemberDb();
  own.role = "team-editor";
  own.teamId = "team_a";
  assert.equal((await handleFieldGroupMembersApi(request(), own))?.status, 200);

  const foreign = new MemberDb();
  foreign.role = "team-editor";
  foreign.teamId = "team_b";
  assert.equal((await handleFieldGroupMembersApi(request(), foreign))?.status, 403);

  const viewer = new MemberDb();
  viewer.role = "viewer";
  assert.equal((await handleFieldGroupMembersApi(request(), viewer))?.status, 403);
});

test("direct roster read expires a forgotten active group before returning members", async () => {
  const db = new MemberDb();
  db.hardExpiresAt = "2020-01-01T00:00:00.000Z";
  const response = await quietAudit(() => handleFieldGroupMembersApi(request(), db));
  assert.equal(response?.status, 409);
  assert.equal((await response?.json()).error.code, "group_not_active");
  assert.equal(db.groupState, "expired");
});

test("member roster collection rejects writes", async () => {
  const db = new MemberDb();
  const response = await handleFieldGroupMembersApi(request("POST"), db);
  assert.equal(response?.status, 405);
});

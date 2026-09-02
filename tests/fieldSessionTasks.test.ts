import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentAccessRole } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from "../worker/campaignRepository.ts";
import {
  handleFieldSessionTasksApi,
  parseFieldSessionTasksRoute,
} from "../worker/fieldSessionTasks.ts";

type AccessMode =
  | { kind: "persistent"; role: PersistentAccessRole; teamId: string | null }
  | { kind: "temporary"; teamId: string; groupId: string }
  | { kind: "none" };

type Session = {
  id: string;
  teamId: string;
  groupId: string | null;
};

type TaskRef = {
  entityType: "street-task" | "house-task";
  entityId: string;
};

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: SessionTaskDb,
    readonly query: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    const query = this.query.replace(/\s+/gu, " ");

    if (query.includes("FROM campaign_sessions s")) {
      if (this.db.access.kind !== "persistent") return null;
      const campaignId = this.values[2] as string | null;
      if (campaignId && campaignId !== "campaign_a") return null;
      return {
        grant_id: `grant_${this.db.access.role}`,
        campaign_id: "campaign_a",
        role: this.db.access.role,
        team_id: this.db.access.teamId,
        label: "Test access",
      } as T;
    }

    if (query.includes("FROM field_group_memberships m JOIN field_groups g")) {
      if (this.db.access.kind !== "temporary") return null;
      const campaignId = this.values[1] as string | null;
      if (campaignId && campaignId !== "campaign_a") return null;
      return {
        membership_id: "membership_temp",
        campaign_id: "campaign_a",
        group_id: this.db.access.groupId,
        team_id: this.db.access.teamId,
        expires_at: "2099-01-01T00:00:00.000Z",
        left_at: null,
        removed_at: null,
        label: "Temporary group",
        state: "active",
        hard_expires_at: "2099-01-01T00:00:00.000Z",
      } as T;
    }

    if (query.includes("FROM field_sessions")) {
      if (this.db.schemaMissing) throw new Error("no such table: field_sessions");
      const sessionId = this.values[0] as string;
      const campaignId = this.values[1] as string;
      if (campaignId !== "campaign_a") return null;
      const session = this.db.sessions.find((candidate) => candidate.id === sessionId);
      return session
        ? ({
            id: session.id,
            team_id: session.teamId,
            field_group_id: session.groupId,
          } as T)
        : null;
    }

    return null;
  }

  async all<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (!query.includes("FROM domain_events")) return { results: [] as T[] };
    if (this.db.schemaMissing) throw new Error("no such table: domain_events");

    const campaignId = this.values[0] as string;
    const sessionId = this.values[1] as string;
    const cursorType = this.values[2] as TaskRef["entityType"] | null;
    const cursorId = this.values[5] as string | null;
    const limit = this.values[6] as number;
    if (campaignId !== "campaign_a") return { results: [] as T[] };

    const seen = new Set<string>();
    const rows = this.db.taskRefs
      .filter((entry) => entry.sessionId === sessionId)
      .filter((entry) => {
        if (!cursorType || !cursorId) return true;
        return (
          entry.entityType > cursorType ||
          (entry.entityType === cursorType && entry.entityId > cursorId)
        );
      })
      .sort((a, b) => {
        const byType = a.entityType.localeCompare(b.entityType);
        return byType !== 0 ? byType : a.entityId.localeCompare(b.entityId);
      })
      .filter((entry) => {
        const key = `${entry.entityType}:${entry.entityId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map((entry) => ({
        entity_type: entry.entityType,
        entity_id: entry.entityId,
      }));

    return { results: rows as T[] };
  }
}

class SessionTaskDb implements D1DatabaseLike {
  access: AccessMode = { kind: "persistent", role: "admin", teamId: null };
  schemaMissing = false;
  sessions: Session[] = [
    { id: "session_a", teamId: "team_a", groupId: "group_a" },
    { id: "session_b", teamId: "team_a", groupId: "group_b" },
    { id: "session_c", teamId: "team_b", groupId: "group_c" },
  ];
  taskRefs: Array<TaskRef & { sessionId: string }> = [
    { sessionId: "session_a", entityType: "street-task", entityId: "task_b" },
    { sessionId: "session_a", entityType: "street-task", entityId: "task_a" },
    { sessionId: "session_a", entityType: "street-task", entityId: "task_a" },
    { sessionId: "session_a", entityType: "house-task", entityId: "house_a" },
    { sessionId: "session_b", entityType: "street-task", entityId: "task_other" },
  ];

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch() {
    return [];
  }
}

function persistentRequest(sessionId = "session_a", query = "", method = "GET") {
  return new Request(
    `https://flyer.test/api/campaigns/campaign_a/field-sessions/${sessionId}/tasks${query}`,
    {
      method,
      headers: { cookie: "vf_session=test-session" },
    },
  );
}

function temporaryRequest(sessionId = "session_a", query = "") {
  return new Request(
    `https://flyer.test/api/campaigns/campaign_a/field-sessions/${sessionId}/tasks${query}`,
    {
      headers: { cookie: "vf_field_group_session=test-session" },
    },
  );
}

test("Field Session task route is exact and safely decoded", () => {
  assert.deepEqual(
    parseFieldSessionTasksRoute("/api/campaigns/campaign_a/field-sessions/session_a/tasks"),
    { campaignId: "campaign_a", sessionId: "session_a" },
  );
  assert.equal(
    parseFieldSessionTasksRoute("/api/campaigns/campaign_a/field-sessions/session_a"),
    null,
  );
  assert.equal(
    parseFieldSessionTasksRoute("/api/campaigns/%2F/field-sessions/session_a/tasks"),
    null,
  );
  assert.equal(
    parseFieldSessionTasksRoute("/api/campaigns/campaign_a/field-sessions/%2F/tasks"),
    null,
  );
});

test("admin receives deduplicated task references with stable pagination", async () => {
  const db = new SessionTaskDb();
  const first = await handleFieldSessionTasksApi(persistentRequest("session_a", "?limit=2"), db);
  assert.equal(first?.status, 200);
  const firstBody = await first?.json();
  assert.deepEqual(firstBody.taskRefs, [
    { entityType: "house-task", entityId: "house_a" },
    { entityType: "street-task", entityId: "task_a" },
  ]);
  assert.equal(firstBody.nextCursor, "street-task|task_a");

  const second = await handleFieldSessionTasksApi(
    persistentRequest(
      "session_a",
      `?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
    ),
    db,
  );
  assert.equal(second?.status, 200);
  const secondBody = await second?.json();
  assert.deepEqual(secondBody.taskRefs, [
    { entityType: "street-task", entityId: "task_b" },
  ]);
  assert.equal(secondBody.nextCursor, null);
});

test("Team Editor may read only sessions from its own team", async () => {
  const db = new SessionTaskDb();
  db.access = { kind: "persistent", role: "team-editor", teamId: "team_a" };

  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_a"), db))?.status, 200);
  const foreign = await handleFieldSessionTasksApi(persistentRequest("session_c"), db);
  assert.equal(foreign?.status, 403);
  assert.equal((await foreign?.json()).error.code, "field_session_scope_forbidden");
});

test("temporary member is restricted to its exact Field Group session", async () => {
  const db = new SessionTaskDb();
  db.access = { kind: "temporary", teamId: "team_a", groupId: "group_a" };

  assert.equal((await handleFieldSessionTasksApi(temporaryRequest("session_a"), db))?.status, 200);
  assert.equal((await handleFieldSessionTasksApi(temporaryRequest("session_b"), db))?.status, 403);
  assert.equal((await handleFieldSessionTasksApi(temporaryRequest("session_c"), db))?.status, 403);
});

test("viewer may read Campaign-scoped session task references", async () => {
  const db = new SessionTaskDb();
  db.access = { kind: "persistent", role: "viewer", teamId: null };
  const response = await handleFieldSessionTasksApi(persistentRequest("session_c"), db);
  assert.equal(response?.status, 200);
});

test("missing session, invalid pagination and writes fail closed", async () => {
  const db = new SessionTaskDb();
  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_missing"), db))?.status, 404);
  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_a", "?limit=0"), db))?.status, 400);
  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_a", "?limit=1001"), db))?.status, 400);
  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_a", "?cursor=broken"), db))?.status, 400);
  assert.equal((await handleFieldSessionTasksApi(persistentRequest("session_a", "", "POST"), db))?.status, 405);
});

test("missing migration 0007 surfaces explicit schema error", async () => {
  const db = new SessionTaskDb();
  db.schemaMissing = true;
  const response = await handleFieldSessionTasksApi(persistentRequest(), db);
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).error.code, "field_session_schema_unavailable");
});

test("unauthorized task reference reads are rejected", async () => {
  const db = new SessionTaskDb();
  db.access = { kind: "none" };
  const response = await handleFieldSessionTasksApi(persistentRequest(), db);
  assert.equal(response?.status, 401);
});

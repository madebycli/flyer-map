import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentAccessRole } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from "../worker/campaignRepository.ts";
import {
  handleFieldSessionsApi,
  parseFieldSessionsRoute,
} from "../worker/fieldSessions.ts";

type Session = {
  id: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  groupId: string | null;
  mode: "distribution" | "collection";
  startedAt: string;
  endedAt: string | null;
  endReason: "manual-close" | "group-expired" | null;
  durationSeconds: number | null;
  participantCount: number | null;
  personSeconds: number | null;
  note: string | null;
  affectedTaskCount: number;
  status: "active" | "closed";
};

type AccessMode =
  | { kind: "persistent"; role: PersistentAccessRole; teamId: string | null }
  | { kind: "temporary"; teamId: string; groupId: string }
  | { kind: "none" };

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: SessionDb,
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

    return null;
  }

  async all<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (!query.includes("FROM field_sessions s")) return { results: [] as T[] };
    if (this.db.schemaMissing) throw new Error("no such table: field_sessions");

    const campaignId = this.values[0] as string;
    const teamId = this.values[1] as string | null;
    const groupId = this.values[3] as string | null;
    const cursorStartedAt = this.values[5] as string | null;
    const cursorId = this.values[8] as string | null;
    const limit = this.values[9] as number;

    if (campaignId !== "campaign_a") return { results: [] as T[] };

    const rows = this.db.sessions
      .filter((session) => !teamId || session.teamId === teamId)
      .filter((session) => !groupId || session.groupId === groupId)
      .filter((session) => {
        if (!cursorStartedAt || !cursorId) return true;
        return session.startedAt < cursorStartedAt ||
          (session.startedAt === cursorStartedAt && session.id < cursorId);
      })
      .sort((a, b) => {
        const date = b.startedAt.localeCompare(a.startedAt);
        return date !== 0 ? date : b.id.localeCompare(a.id);
      })
      .slice(0, limit)
      .map((session) => ({
        id: session.id,
        campaign_id: "campaign_a",
        team_id: session.teamId,
        team_name: session.teamName,
        team_color: session.teamColor,
        field_group_id: session.groupId,
        mode: session.mode,
        started_at: session.startedAt,
        ended_at: session.endedAt,
        end_reason: session.endReason,
        duration_seconds: session.durationSeconds,
        participant_count: session.participantCount,
        person_seconds: session.personSeconds,
        note: session.note,
        affected_task_count: session.affectedTaskCount,
        status: session.status,
      }));

    return { results: rows as T[] };
  }
}

class SessionDb implements D1DatabaseLike {
  access: AccessMode = { kind: "persistent", role: "admin", teamId: null };
  schemaMissing = false;
  sessions: Session[] = [
    {
      id: "session_c",
      teamId: "team_b",
      teamName: "Süd",
      teamColor: "#222222",
      groupId: "group_c",
      mode: "collection",
      startedAt: "2026-08-27T12:00:00.000Z",
      endedAt: "2026-08-27T13:00:00.000Z",
      endReason: "manual-close",
      durationSeconds: 3600,
      participantCount: 2,
      personSeconds: 7200,
      note: null,
      affectedTaskCount: 1,
      status: "closed",
    },
    {
      id: "session_b",
      teamId: "team_a",
      teamName: "Nord",
      teamColor: "#111111",
      groupId: "group_b",
      mode: "distribution",
      startedAt: "2026-08-27T10:00:00.000Z",
      endedAt: "2026-08-27T11:00:00.000Z",
      endReason: "group-expired",
      durationSeconds: 3600,
      participantCount: null,
      personSeconds: null,
      note: "  Wird nicht zugestellt <script>  ",
      affectedTaskCount: 2,
      status: "closed",
    },
    {
      id: "session_a",
      teamId: "team_a",
      teamName: "Nord",
      teamColor: "#111111",
      groupId: "group_a",
      mode: "distribution",
      startedAt: "2026-08-27T10:00:00.000Z",
      endedAt: "2026-08-27T10:30:00.000Z",
      endReason: "manual-close",
      durationSeconds: 1800,
      participantCount: 3,
      personSeconds: 5400,
      note: null,
      affectedTaskCount: 3,
      status: "closed",
    },
  ];

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch() {
    return [];
  }
}

function persistentRequest(query = "") {
  return new Request(`https://flyer.test/api/campaigns/campaign_a/field-sessions${query}`, {
    headers: { cookie: "vf_session=test-session" },
  });
}

function temporaryRequest(query = "") {
  return new Request(`https://flyer.test/api/campaigns/campaign_a/field-sessions${query}`, {
    headers: { cookie: "vf_field_group_session=test-session" },
  });
}

test("Field Session history route is exact and decoded safely", () => {
  assert.deepEqual(parseFieldSessionsRoute("/api/campaigns/campaign_a/field-sessions"), {
    campaignId: "campaign_a",
  });
  assert.equal(parseFieldSessionsRoute("/api/campaigns/campaign_a/field-sessions/session_a"), null);
  assert.equal(parseFieldSessionsRoute("/api/campaigns/%2F/field-sessions"), null);
});

test("admin history is bounded and cursor pagination is stable for equal timestamps", async () => {
  const db = new SessionDb();
  const first = await handleFieldSessionsApi(persistentRequest("?limit=2"), db);
  assert.equal(first?.status, 200);
  const firstBody = await first?.json();
  assert.deepEqual(firstBody.sessions.map((session: { id: string }) => session.id), [
    "session_c",
    "session_b",
  ]);
  assert.equal(firstBody.nextCursor, "2026-08-27T10:00:00.000Z|session_b");

  const second = await handleFieldSessionsApi(
    persistentRequest(`?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`),
    db,
  );
  assert.equal(second?.status, 200);
  const secondBody = await second?.json();
  assert.deepEqual(secondBody.sessions.map((session: { id: string }) => session.id), ["session_a"]);
  assert.equal(secondBody.nextCursor, null);
});

test("history response exposes optional inert note with otherwise minimized session fields", async () => {
  const db = new SessionDb();
  const response = await handleFieldSessionsApi(persistentRequest("?team=team_a"), db);
  assert.equal(response?.status, 200);
  const body = await response?.json();
  assert.equal(body.sessions.length, 2);
  assert.equal(body.sessions[0].participantCount, null);
  assert.equal(body.sessions[0].personSeconds, null);
  assert.equal(body.sessions[0].note, "  Wird nicht zugestellt <script>  ");
  assert.equal(body.sessions[0].affectedTaskCount, 2);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /payload|actor|secret|hash|room|qr|gps|longitude|latitude/iu);
});

test("Team Editor is forced to own team and cannot widen scope with query", async () => {
  const db = new SessionDb();
  db.access = { kind: "persistent", role: "team-editor", teamId: "team_a" };

  const own = await handleFieldSessionsApi(persistentRequest(), db);
  assert.equal(own?.status, 200);
  assert.deepEqual(
    (await own?.json()).sessions.map((session: { teamId: string }) => session.teamId),
    ["team_a", "team_a"],
  );

  const foreign = await handleFieldSessionsApi(persistentRequest("?team=team_b"), db);
  assert.equal(foreign?.status, 403);
  assert.equal((await foreign?.json()).error.code, "field_session_scope_forbidden");
});

test("viewer may use Campaign-scoped team filter", async () => {
  const db = new SessionDb();
  db.access = { kind: "persistent", role: "viewer", teamId: null };
  const response = await handleFieldSessionsApi(persistentRequest("?team=team_b"), db);
  assert.equal(response?.status, 200);
  const body = await response?.json();
  assert.deepEqual(body.sessions.map((session: { id: string }) => session.id), ["session_c"]);
});

test("temporary Field Group access is restricted to its own group history", async () => {
  const db = new SessionDb();
  db.access = { kind: "temporary", teamId: "team_a", groupId: "group_a" };
  const response = await handleFieldSessionsApi(temporaryRequest(), db);
  assert.equal(response?.status, 200);
  const body = await response?.json();
  assert.deepEqual(body.sessions.map((session: { id: string }) => session.id), ["session_a"]);

  const foreign = await handleFieldSessionsApi(temporaryRequest("?team=team_b"), db);
  assert.equal(foreign?.status, 403);
});

test("invalid filters, cursor and limit fail closed", async () => {
  const db = new SessionDb();
  assert.equal((await handleFieldSessionsApi(persistentRequest("?team=%2F"), db))?.status, 400);
  assert.equal((await handleFieldSessionsApi(persistentRequest("?limit=0"), db))?.status, 400);
  assert.equal((await handleFieldSessionsApi(persistentRequest("?limit=101"), db))?.status, 400);
  assert.equal((await handleFieldSessionsApi(persistentRequest("?cursor=broken"), db))?.status, 400);
});

test("missing migration 0007 returns explicit schema error after authorization", async () => {
  const db = new SessionDb();
  db.schemaMissing = true;
  const response = await handleFieldSessionsApi(persistentRequest(), db);
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).error.code, "field_session_schema_unavailable");
});

test("unauthorized and write requests are rejected", async () => {
  const db = new SessionDb();
  db.access = { kind: "none" };
  const unauthorized = await handleFieldSessionsApi(persistentRequest(), db);
  assert.equal(unauthorized?.status, 401);

  const write = await handleFieldSessionsApi(
    new Request("https://flyer.test/api/campaigns/campaign_a/field-sessions", {
      method: "POST",
      headers: { cookie: "vf_session=test-session" },
    }),
    new SessionDb(),
  );
  assert.equal(write?.status, 405);
});

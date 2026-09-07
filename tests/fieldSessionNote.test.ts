import assert from "node:assert/strict";
import test from "node:test";
import type { PersistentAccessRole } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import {
  handleFieldSessionNoteApi,
  parseFieldSessionNoteRoute,
} from "../worker/fieldSessionNote.ts";

type AccessMode =
  | { kind: "persistent"; role: PersistentAccessRole; teamId: string | null }
  | { kind: "temporary"; teamId: string; groupId: string }
  | { kind: "none" };

type Session = {
  id: string;
  teamId: string;
  note: string | null;
};

class Statement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: NoteDb,
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
      return session ? ({ id: session.id, team_id: session.teamId } as T) : null;
    }

    return null;
  }

  async all<T>() {
    return { results: [] as T[] };
  }
}

class NoteDb implements D1DatabaseLike {
  access: AccessMode = { kind: "persistent", role: "admin", teamId: null };
  schemaMissing = false;
  sessions: Session[] = [
    { id: "session_a", teamId: "team_a", note: null },
    { id: "session_b", teamId: "team_b", note: "Alt" },
  ];
  lastUpdateQuery: string | null = null;
  lastUpdateValues: unknown[] = [];

  prepare(query: string) {
    return new Statement(this, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]> {
    const statement = statements[0] as Statement;
    this.lastUpdateQuery = statement.query;
    this.lastUpdateValues = [...statement.values];
    if (this.schemaMissing) throw new Error("no such column: note");
    if (!statement.query.includes("UPDATE field_sessions")) {
      return [{ success: true, meta: { changes: 0 } }];
    }
    const note = statement.values[0] as string | null;
    const sessionId = statement.values[2] as string;
    const campaignId = statement.values[3] as string;
    if (campaignId !== "campaign_a") return [{ success: true, meta: { changes: 0 } }];
    const session = this.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return [{ success: true, meta: { changes: 0 } }];
    session.note = note;
    return [{ success: true, meta: { changes: 1 } }];
  }
}

function request(
  sessionId = "session_a",
  note = "Treffpunkt am Gemeindehaus",
  options: { origin?: string; method?: string; cookie?: string; rawBody?: string } = {},
) {
  const body = options.rawBody ?? JSON.stringify({ note });
  return new Request(
    `https://flyer.test/api/campaigns/campaign_a/field-sessions/${sessionId}/note`,
    {
      method: options.method ?? "PATCH",
      headers: {
        cookie: options.cookie ?? "vf_session=test-session",
        "content-type": "application/json",
        ...(options.origin ? { origin: options.origin } : {}),
      },
      body: options.method === "GET" ? undefined : body,
    },
  );
}

test("Field Session note route is exact and safely decoded", () => {
  assert.deepEqual(
    parseFieldSessionNoteRoute("/api/campaigns/campaign_a/field-sessions/session_a/note"),
    { campaignId: "campaign_a", sessionId: "session_a" },
  );
  assert.equal(parseFieldSessionNoteRoute("/api/campaigns/campaign_a/field-sessions/session_a"), null);
  assert.equal(parseFieldSessionNoteRoute("/api/campaigns/%2F/field-sessions/session_a/note"), null);
  assert.equal(parseFieldSessionNoteRoute("/api/campaigns/campaign_a/field-sessions/%2F/note"), null);
});

test("admin can set a trimmed inert session note", async () => {
  const db = new NoteDb();
  const hostile = "  <script>alert(1)</script>'; DROP TABLE field_sessions; --  ";
  const response = await handleFieldSessionNoteApi(request("session_a", hostile), db);
  assert.equal(response?.status, 200);
  assert.equal((await response?.json()).note, hostile.trim());
  assert.equal(db.sessions[0].note, hostile.trim());
  assert.equal(db.lastUpdateValues[0], hostile.trim());
  assert.doesNotMatch(db.lastUpdateQuery ?? "", /DROP TABLE|<script>/u);
});

test("empty note clears the stored note", async () => {
  const db = new NoteDb();
  db.sessions[0].note = "Vorher";
  const response = await handleFieldSessionNoteApi(request("session_a", "   \n  "), db);
  assert.equal(response?.status, 200);
  assert.equal((await response?.json()).note, null);
  assert.equal(db.sessions[0].note, null);
});

test("Team Editor can edit only own-team session notes", async () => {
  const db = new NoteDb();
  db.access = { kind: "persistent", role: "team-editor", teamId: "team_a" };
  assert.equal((await handleFieldSessionNoteApi(request("session_a"), db))?.status, 200);

  const foreign = await handleFieldSessionNoteApi(request("session_b"), db);
  assert.equal(foreign?.status, 403);
  assert.equal((await foreign?.json()).error.code, "field_session_note_forbidden");
});

test("viewer and temporary Field Group member remain read-only for session notes", async () => {
  const viewerDb = new NoteDb();
  viewerDb.access = { kind: "persistent", role: "viewer", teamId: null };
  assert.equal((await handleFieldSessionNoteApi(request(), viewerDb))?.status, 403);

  const temporaryDb = new NoteDb();
  temporaryDb.access = { kind: "temporary", teamId: "team_a", groupId: "group_a" };
  const temporary = await handleFieldSessionNoteApi(
    request("session_a", "Nein", { cookie: "vf_field_group_session=test-session" }),
    temporaryDb,
  );
  assert.equal(temporary?.status, 403);
});

test("note body is strict, bounded and rejects unknown fields", async () => {
  const db = new NoteDb();
  assert.equal((await handleFieldSessionNoteApi(request("session_a", "x".repeat(1000)), db))?.status, 200);
  assert.equal((await handleFieldSessionNoteApi(request("session_a", "x".repeat(1001)), db))?.status, 400);
  assert.equal(
    (
      await handleFieldSessionNoteApi(
        request("session_a", "", { rawBody: JSON.stringify({ note: "ok", extra: true }) }),
        db,
      )
    )?.status,
    400,
  );
  assert.equal(
    (await handleFieldSessionNoteApi(request("session_a", "", { rawBody: "{broken" }), db))?.status,
    400,
  );
});

test("cross-origin writes, wrong methods and unauthenticated writes fail closed", async () => {
  const db = new NoteDb();
  assert.equal(
    (
      await handleFieldSessionNoteApi(
        request("session_a", "x", { origin: "https://evil.test" }),
        db,
      )
    )?.status,
    403,
  );
  assert.equal((await handleFieldSessionNoteApi(request("session_a", "x", { method: "GET" }), db))?.status, 405);

  db.access = { kind: "none" };
  assert.equal((await handleFieldSessionNoteApi(request(), db))?.status, 401);
});

test("missing session and missing migration surface explicit errors", async () => {
  const db = new NoteDb();
  assert.equal((await handleFieldSessionNoteApi(request("session_missing"), db))?.status, 404);

  db.schemaMissing = true;
  const response = await handleFieldSessionNoteApi(request(), db);
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).error.code, "field_session_schema_unavailable");
});

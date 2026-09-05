import assert from "node:assert/strict";
import test from "node:test";
import { randomSecret, type PersistentAccessRole } from "../worker/access.ts";
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1RunResult,
} from "../worker/campaignRepository.ts";
import { buildFieldGroupAuditEvent } from "../worker/fieldGroupAudit.ts";
import {
  canonicalizeFieldGroupQrToken,
  canonicalizeFieldGroupRoomCode,
  generateFieldGroupRoomCode,
  handleFieldGroupApi,
  parseFieldGroupRoute,
} from "../worker/fieldGroups.ts";

const TEST_RECOVERY_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

type StoredGroup = {
  id: string;
  campaign_id: string;
  team_id: string;
  label: string;
  mode: "distribution" | "collection";
  discoverable: number;
  state: "active" | "closed" | "expired";
  participant_count: number | null;
  create_request_id: string;
  create_payload_hash: string;
  created_at: string;
  hard_expires_at: string;
  closed_at: string | null;
  updated_at: string;
  team_name: string;
  team_color: string;
  join_available: number;
  membership_count: number;
};

type StoredCredential = {
  id: string;
  campaignId: string;
  groupId: string;
  issuanceType: "create" | "rotate";
  requestId: string;
  secretHash: string;
  revokedAt: string | null;
};

class FieldGroupStatement implements D1PreparedStatement {
  values: unknown[] = [];

  constructor(
    readonly db: FieldGroupDb,
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

    if (query.includes("SELECT id, name, color FROM teams")) {
      const [teamId, campaignId] = this.values as [string, string];
      if (campaignId !== "campaign_a") return null;
      const team = this.db.teams.get(teamId);
      return (team ?? null) as T | null;
    }

    if (query.includes("FROM field_groups") && query.includes("create_request_id = ?")) {
      const [campaignId, requestId] = this.values as [string, string];
      const group = this.db.groups.find(
        (candidate) =>
          candidate.campaign_id === campaignId && candidate.create_request_id === requestId,
      );
      return (group
        ? { id: group.id, create_payload_hash: group.create_payload_hash }
        : null) as T | null;
    }

    if (
      query.includes("FROM field_group_join_credentials") &&
      query.includes("issuance_type = ?") &&
      query.includes("request_id = ?")
    ) {
      const [campaignId, groupId, issuanceType, requestId] = this.values as [
        string,
        string,
        "create" | "rotate",
        string,
      ];
      const credential = this.db.credentials.find(
        (candidate) =>
          candidate.campaignId === campaignId &&
          candidate.groupId === groupId &&
          candidate.issuanceType === issuanceType &&
          candidate.requestId === requestId,
      );
      return (credential ? { id: credential.id } : null) as T | null;
    }

    if (query.includes("FROM field_groups g") && query.includes("WHERE g.id = ?")) {
      const groupId = this.values.at(-2) as string;
      const campaignId = this.values.at(-1) as string;
      return (
        this.db.groups.find(
          (group) => group.id === groupId && group.campaign_id === campaignId,
        ) ?? null
      ) as T | null;
    }

    return null;
  }

  async all<T>() {
    const query = this.query.replace(/\s+/gu, " ");
    if (this.db.simulateMissingSchema && query.includes("FROM field_groups")) {
      throw new Error("D1_ERROR: no such column: field_groups.discoverable");
    }
    if (
      query.includes("FROM field_groups") &&
      query.includes("state = 'active' AND hard_expires_at <=")
    ) {
      return { results: [] as T[] };
    }
    if (query.includes("FROM field_groups g") && query.includes("g.discoverable = 1")) {
      return {
        results: this.db.groups.filter(
          (group) => group.state === "active" && group.discoverable === 1,
        ) as T[],
      };
    }
    return { results: [] as T[] };
  }
}

class FieldGroupDb implements D1DatabaseLike {
  role: PersistentAccessRole = "admin";
  teamId: string | null = null;
  simulateMissingSchema = false;
  capturedValues: unknown[][] = [];
  credentialHashes: string[] = [];
  credentials: StoredCredential[] = [];
  groups: StoredGroup[] = [];
  teams = new Map([
    ["team_a", { id: "team_a", name: "Team A", color: "#2563eb" }],
    ["team_b", { id: "team_b", name: "Team B", color: "#ea580c" }],
  ]);

  prepare(query: string) {
    return new FieldGroupStatement(this, query);
  }

  async batch(statements: D1PreparedStatement[]) {
    const results: D1RunResult[] = [];
    for (const statement of statements as FieldGroupStatement[]) {
      const query = statement.query.replace(/\s+/gu, " ").trim();
      this.capturedValues.push(statement.values);
      let changes = 1;

      if (query.startsWith("INSERT INTO field_groups")) {
        const [
          id,
          campaignId,
          teamId,
          label,
          mode,
          discoverable,
          participantCount,
          ,
          requestId,
          payloadHash,
          createdAt,
          hardExpiresAt,
          updatedAt,
        ] = statement.values as [
          string,
          string,
          string,
          string,
          "distribution" | "collection",
          number,
          number | null,
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const team = this.teams.get(teamId)!;
        this.groups.push({
          id,
          campaign_id: campaignId,
          team_id: teamId,
          label,
          mode,
          discoverable,
          state: "active",
          participant_count: participantCount,
          create_request_id: requestId,
          create_payload_hash: payloadHash,
          created_at: createdAt,
          hard_expires_at: hardExpiresAt,
          closed_at: null,
          updated_at: updatedAt,
          team_name: team.name,
          team_color: team.color,
          join_available: 1,
          membership_count: 0,
        });
      } else if (query.startsWith("INSERT INTO field_group_join_credentials")) {
        const [id, campaignId, groupId, requestId, secretHash] = statement.values as [
          string,
          string,
          string,
          string,
          string,
          string,
        ];
        const issuanceType = query.includes("'rotate'") ? "rotate" : "create";
        this.credentials.push({
          id,
          campaignId,
          groupId,
          issuanceType,
          requestId,
          secretHash,
          revokedAt: null,
        });
        this.credentialHashes.push(secretHash);
      } else if (query.startsWith("UPDATE field_group_join_credentials")) {
        const [revokedAt, groupId, campaignId] = statement.values as [string, string, string];
        changes = 0;
        for (const credential of this.credentials) {
          if (
            credential.groupId === groupId &&
            credential.campaignId === campaignId &&
            credential.revokedAt === null
          ) {
            credential.revokedAt = revokedAt;
            changes += 1;
          }
        }
      } else if (query.startsWith("UPDATE field_groups")) {
        changes = 0;
      }

      results.push({ success: true, meta: { changes } });
    }
    return results;
  }
}

function request(
  path: string,
  method: string,
  body?: Record<string, unknown>,
  options?: { origin?: string; cookie?: string },
) {
  const headers = new Headers();
  headers.set("origin", options?.origin ?? "https://flyer.test");
  if (options?.cookie !== null) headers.set("cookie", options?.cookie ?? "vf_session=test-session");
  if (body) headers.set("content-type", "application/json");
  return new Request(`https://flyer.test${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
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

test("room code uses the accepted 10-character human-safe Base32 alphabet", () => {
  const codes = new Set<string>();
  for (let index = 0; index < 100; index += 1) {
    const code = generateFieldGroupRoomCode();
    assert.match(code, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/u);
    codes.add(code);
  }
  assert.ok(codes.size > 95);
  assert.equal(canonicalizeFieldGroupRoomCode("2345-6789-ab"), "23456789AB");
  assert.equal(canonicalizeFieldGroupRoomCode("234567890A"), null);
  assert.equal(canonicalizeFieldGroupRoomCode("23456789IA"), null);
});

test("QR join token has 32-byte base64url shape and strict canonicalization", () => {
  const first = randomSecret();
  const second = randomSecret();
  assert.equal(first.length, 43);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first, second);
  assert.equal(canonicalizeFieldGroupQrToken(` ${first} `), first);
  assert.equal(canonicalizeFieldGroupQrToken("short"), null);
});

test("field group route parser keeps campaign, group and membership selectors scoped", () => {
  assert.deepEqual(parseFieldGroupRoute("/api/field-groups/join"), { kind: "join" });
  assert.deepEqual(parseFieldGroupRoute("/api/campaigns/campaign_a/field-groups/field_group_a/credentials/current"), { kind: "reveal", campaignId: "campaign_a", groupId: "field_group_a" });
  assert.deepEqual(parseFieldGroupRoute("/api/campaigns/campaign_a/field-groups"), {
    kind: "collection",
    campaignId: "campaign_a",
  });
  assert.deepEqual(
    parseFieldGroupRoute(
      "/api/campaigns/campaign_a/field-groups/field_group_a/memberships/membership_a",
    ),
    {
      kind: "remove-member",
      campaignId: "campaign_a",
      groupId: "field_group_a",
      membershipId: "membership_a",
    },
  );
  assert.equal(parseFieldGroupRoute("/api/campaigns/%2F/field-groups"), null);
});

test("missing 0006 field-group columns return a specific migration response instead of 500", async () => {
  const db = new FieldGroupDb();
  db.simulateMissingSchema = true;
  const response = await handleFieldGroupApi(
    request("/api/campaigns/campaign_a/field-groups", "GET"),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).error.code, "field_group_schema_unavailable");
});

test("field group audit builder drops credential, session and IP extras", () => {
  const event = buildFieldGroupAuditEvent({
    kind: "field_group.joined",
    campaignId: "campaign_a",
    groupId: "field_group_a",
    teamId: "team_a",
    membershipId: "membership_a",
    actorKind: "temporary-member",
    actorRef: "membership_a",
    roomCode: "SECRETROOM",
    qrToken: "SECRETQR",
    sessionSecret: "SECRETSESSION",
    ip: "203.0.113.1",
  } as never);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /SECRETROOM|SECRETQR|SECRETSESSION|203\.0\.113\.1/u);
  assert.deepEqual(Object.keys(event).sort(), [
    "actorKind",
    "actorRef",
    "at",
    "campaignId",
    "event",
    "groupId",
    "membershipId",
    "teamId",
  ]);
});

test("join fails closed when either required Cloudflare rate-limit binding is missing", async () => {
  const db = new FieldGroupDb();
  const response = await handleFieldGroupApi(
    request("/api/field-groups/join", "POST", {
      campaignId: "campaign_a",
      kind: "room-code",
      secret: "23456789AB",
    }),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).error.code, "join_security_unconfigured");
});

test("actor and credential candidate rate limits return generic 429 before credential lookup", async () => {
  const db = new FieldGroupDb();
  let credentialCalls = 0;
  const actorLimited = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/field-groups/join", "POST", {
        campaignId: "campaign_a",
        kind: "room-code",
        secret: "23456789AB",
      }),
      {
        DB: db,
        FIELD_GROUP_JOIN_ACTOR_LIMITER: {
          limit: async () => ({ success: false }),
        },
        FIELD_GROUP_JOIN_CREDENTIAL_LIMITER: {
          limit: async () => {
            credentialCalls += 1;
            return { success: true };
          },
        },
      },
    ),
  );
  assert.equal(actorLimited?.status, 429);
  assert.equal(credentialCalls, 0);

  const candidateLimited = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/field-groups/join", "POST", {
        campaignId: "campaign_a",
        kind: "room-code",
        secret: "23456789AB",
      }),
      {
        DB: db,
        FIELD_GROUP_JOIN_ACTOR_LIMITER: {
          limit: async () => ({ success: true }),
        },
        FIELD_GROUP_JOIN_CREDENTIAL_LIMITER: {
          limit: async () => ({ success: false }),
        },
      },
    ),
  );
  assert.equal(candidateLimited?.status, 429);
  assert.equal((await candidateLimited?.json()).error.code, "join_rate_limited");
});

test("create stores only credential hashes and enforces legacy team management scope", async () => {
  const adminDb = new FieldGroupDb();
  const adminResponse = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Tour Nord",
        teamId: "team_b",
        discoverable: true,
        requestId: "create-admin-001",
      }),
      { DB: adminDb, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(adminResponse?.status, 201);
  const adminBody = await adminResponse?.json();
  const roomCode = adminBody.credentials.roomCode as string;
  const qrToken = adminBody.credentials.qrToken as string;
  assert.equal(adminDb.credentialHashes.length, 2);
  assert.equal(JSON.stringify(adminDb.capturedValues).includes(roomCode), false);
  assert.equal(JSON.stringify(adminDb.capturedValues).includes(qrToken), false);
  assert.equal(adminDb.credentialHashes.every((hash) => hash.length === 64), true);

  const ownTeamDb = new FieldGroupDb();
  ownTeamDb.role = "team-editor";
  ownTeamDb.teamId = "team_a";
  const ownTeam = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Eigene Tour",
        teamId: "team_a",
        requestId: "create-own-team-001",
      }),
      { DB: ownTeamDb, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(ownTeam?.status, 201);

  const foreignTeamDb = new FieldGroupDb();
  foreignTeamDb.role = "team-editor";
  foreignTeamDb.teamId = "team_a";
  const foreignTeam = await handleFieldGroupApi(
    request("/api/campaigns/campaign_a/field-groups", "POST", {
      label: "Fremde Tour",
      teamId: "team_b",
      requestId: "create-foreign-001",
    }),
    { DB: foreignTeamDb, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(foreignTeam?.status, 403);
  assert.equal(foreignTeamDb.groups.length, 0);

  const viewerDb = new FieldGroupDb();
  viewerDb.role = "viewer";
  const viewer = await handleFieldGroupApi(
    request("/api/campaigns/campaign_a/field-groups", "POST", {
      label: "Viewer Tour",
      teamId: "team_a",
      requestId: "create-viewer-001",
    }),
    { DB: viewerDb, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(viewer?.status, 403);
  assert.equal(viewerDb.groups.length, 0);
});

test("create replay returns the original group without issuing secrets or duplicating state", async () => {
  const db = new FieldGroupDb();
  const body = {
    label: "Retry Tour",
    teamId: "team_a",
    discoverable: true,
    participantCount: 3,
    requestId: "create-retry-001",
  };

  const first = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", body),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(first?.status, 201);
  const firstBody = await first?.json();
  assert.equal(firstBody.alreadyApplied, false);
  assert.ok(firstBody.credentials?.roomCode);

  const replay = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", body),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(replay?.status, 200);
  const replayBody = await replay?.json();
  assert.equal(replayBody.alreadyApplied, true);
  assert.equal(replayBody.credentials, null);
  assert.equal(replayBody.group.id, firstBody.group.id);
  assert.equal(db.groups.length, 1);
  assert.equal(db.credentialHashes.length, 2);
});

test("create request id cannot be reused for a different payload", async () => {
  const db = new FieldGroupDb();
  const requestId = "create-conflict-001";
  const first = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Erste Tour",
        teamId: "team_a",
        requestId,
      }),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(first?.status, 201);

  const conflict = await handleFieldGroupApi(
    request("/api/campaigns/campaign_a/field-groups", "POST", {
      label: "Andere Tour",
      teamId: "team_a",
      requestId,
    }),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(conflict?.status, 409);
  assert.equal((await conflict?.json()).error.code, "idempotency_key_reused");
  assert.equal(db.groups.length, 1);
  assert.equal(db.credentialHashes.length, 2);
});

test("credential rotation replay never rotates twice or re-exposes generated secrets", async () => {
  const db = new FieldGroupDb();
  const created = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Rotate Tour",
        teamId: "team_a",
        requestId: "create-rotate-test-001",
      }),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(created?.status, 201);
  const createdBody = await created?.json();
  const groupId = createdBody.group.id as string;

  const rotatePath = `/api/campaigns/campaign_a/field-groups/${groupId}/credentials/rotate`;
  const rotateBody = { requestId: "rotate-retry-001" };
  const firstRotation = await quietAudit(() =>
    handleFieldGroupApi(request(rotatePath, "POST", rotateBody), { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY }),
  );
  assert.equal(firstRotation?.status, 200);
  const firstRotationBody = await firstRotation?.json();
  assert.equal(firstRotationBody.alreadyApplied, false);
  assert.ok(firstRotationBody.credentials?.qrToken);
  assert.equal(db.credentialHashes.length, 4);

  const replay = await quietAudit(() =>
    handleFieldGroupApi(request(rotatePath, "POST", rotateBody), { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY }),
  );
  assert.equal(replay?.status, 200);
  const replayBody = await replay?.json();
  assert.equal(replayBody.alreadyApplied, true);
  assert.equal(replayBody.credentials, null);
  assert.equal(db.credentialHashes.length, 4);
});

test("discovery response exposes operational fields but no join credential material", async () => {
  const db = new FieldGroupDb();
  const created = await quietAudit(() =>
    handleFieldGroupApi(
      request("/api/campaigns/campaign_a/field-groups", "POST", {
        label: "Discoverable Tour",
        teamId: "team_a",
        requestId: "create-discovery-001",
      }),
      { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
    ),
  );
  assert.equal(created?.status, 201);

  db.role = "viewer";
  const discovery = await handleFieldGroupApi(
    request("/api/campaigns/campaign_a/field-groups", "GET"),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(discovery?.status, 200);
  const serialized = JSON.stringify(await discovery?.json());
  assert.match(serialized, /Discoverable Tour/u);
  assert.doesNotMatch(serialized, /roomCode|qrToken|secretHash|credentialHash|credentials/u);
});

test("field group browser writes reject cross-origin requests", async () => {
  const db = new FieldGroupDb();
  const response = await handleFieldGroupApi(
    request(
      "/api/campaigns/campaign_a/field-groups",
      "POST",
      { label: "Cross origin", teamId: "team_a" },
      { origin: "https://attacker.example" },
    ),
    { DB: db, FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY: TEST_RECOVERY_KEY },
  );
  assert.equal(response?.status, 403);
  assert.equal(db.groups.length, 0);
});

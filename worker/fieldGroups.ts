import { LIVE_GROUP_MAX_LIFETIME_MS } from "../src/domain/liveGroupTour.ts";
import {
  clearFieldGroupSessionCookie,
  fieldGroupSessionCookie,
  hashSecret,
  randomSecret,
  resolveAccess,
  resolvePersistentAccess,
  type AccessContext,
} from "./access.ts";
import type { D1DatabaseLike, D1PreparedStatement } from "./campaignRepository.ts";
import { emitFieldGroupAudit } from "./fieldGroupAudit.ts";
import {
  decryptFieldGroupCredential,
  encryptFieldGroupCredential,
  FieldGroupCredentialRecoveryError,
} from "./fieldGroupCredentialRecovery.ts";
import { resolveFieldGroupLeaveSession } from "./fieldGroupLeaveSession.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const MAX_FIELD_GROUP_BODY_BYTES = 32_000;
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 10;

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export type FieldGroupEnv = {
  DB?: D1DatabaseLike;
  FIELD_GROUP_JOIN_ACTOR_LIMITER?: RateLimitBinding;
  FIELD_GROUP_JOIN_CREDENTIAL_LIMITER?: RateLimitBinding;
  FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY?: string;
};

type FieldGroupState = "active" | "closed" | "expired";
type FieldGroupMode = "distribution" | "collection";
type CredentialKind = "room-code" | "qr";
type CredentialIssuanceType = "create" | "rotate";

type FieldGroupRow = {
  id: string;
  campaign_id: string;
  team_id: string;
  label: string;
  mode: FieldGroupMode;
  discoverable: number;
  state: FieldGroupState;
  participant_count: number | null;
  created_at: string;
  hard_expires_at: string;
  closed_at: string | null;
  updated_at: string;
  team_name: string;
  team_color: string;
  join_available: number;
  membership_count: number;
};

type ExpiringGroupRow = {
  id: string;
  team_id: string;
  hard_expires_at: string;
};

type CredentialGroupRow = FieldGroupRow & {
  credential_id: string;
};

type MembershipRow = {
  id: string;
  campaign_id: string;
  group_id: string;
  team_id: string;
  campaign_grant_id: string | null;
  joined_at: string;
  expires_at: string;
  left_at: string | null;
  removed_at: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  color: string;
};

type CreateRequestRow = {
  id: string;
  create_payload_hash: string;
};

type CredentialRequestRow = {
  id: string;
};

type RecoverableCredentialRow = {
  credential_id: string;
  kind: CredentialKind;
  iv_b64: string;
  ciphertext_b64: string;
};

type FieldGroupRoute =
  | { kind: "join" }
  | { kind: "collection"; campaignId: string }
  | { kind: "group"; campaignId: string; groupId: string }
  | { kind: "rotate"; campaignId: string; groupId: string }
  | { kind: "reveal"; campaignId: string; groupId: string }
  | { kind: "revoke"; campaignId: string; groupId: string }
  | { kind: "close"; campaignId: string; groupId: string }
  | { kind: "leave"; campaignId: string; groupId: string }
  | {
      kind: "remove-member";
      campaignId: string;
      groupId: string;
      membershipId: string;
    };

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function sameOriginWrite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function validSelector(value: string) {
  return /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
}

function validRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,200}$/u.test(value);
}

function normalizeLabel(value: unknown) {
  if (typeof value !== "string") return null;
  const label = value.trim().replace(/\s+/gu, " ");
  return label.length >= 1 && label.length <= 80 ? label : null;
}

function validParticipantCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 500;
}

function validMode(value: unknown): value is FieldGroupMode {
  return value === "distribution" || value === "collection";
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FIELD_GROUP_BODY_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Request ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_FIELD_GROUP_BODY_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Request ist zu groß."),
    };
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_request", "Request-Daten sind ungültig."),
      };
    }
    return { ok: true as const, value: value as Record<string, unknown> };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON."),
    };
  }
}

export function generateFieldGroupRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = "";
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte & 31];
  return code;
}

export function canonicalizeFieldGroupRoomCode(value: string) {
  const canonical = value.toUpperCase().replace(/[\s-]+/gu, "");
  if (canonical.length !== ROOM_CODE_LENGTH) return null;
  for (const character of canonical) {
    if (!ROOM_CODE_ALPHABET.includes(character)) return null;
  }
  return canonical;
}

export function canonicalizeFieldGroupQrToken(value: string) {
  const canonical = value.trim();
  return /^[A-Za-z0-9_-]{43}$/u.test(canonical) ? canonical : null;
}

function groupPublic(row: FieldGroupRow) {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    teamId: row.team_id,
    teamName: row.team_name,
    teamColor: row.team_color,
    label: row.label,
    mode: row.mode,
    discoverable: row.discoverable === 1,
    state: row.state,
    participantCount: row.participant_count,
    createdAt: row.created_at,
    hardExpiresAt: row.hard_expires_at,
    closedAt: row.closed_at,
    updatedAt: row.updated_at,
    joinAvailable: row.join_available === 1,
    membershipCount: row.membership_count,
  };
}

function accessPublic(access: AccessContext) {
  return {
    campaignId: access.campaignId,
    role: access.role,
    teamId: access.teamId,
    groupId: access.groupId ?? null,
    label: access.label,
  };
}

function auditActor(access: AccessContext) {
  if (access.role === "field-group-member") {
    return {
      actorKind: "temporary-member" as const,
      actorRef: access.membershipId ?? null,
    };
  }
  return { actorKind: "campaign-grant" as const, actorRef: access.grantId };
}

function canManageTeam(access: AccessContext, teamId: string) {
  return access.role === "admin" || (access.role === "team-editor" && access.teamId === teamId);
}

async function teamRow(db: D1DatabaseLike, campaignId: string, teamId: string) {
  return db
    .prepare("SELECT id, name, color FROM teams WHERE id = ? AND campaign_id = ?")
    .bind(teamId, campaignId)
    .first<TeamRow>();
}

async function expireCampaignGroups(db: D1DatabaseLike, campaignId: string, now: string) {
  const expiring = await db
    .prepare(
      `SELECT id, team_id, hard_expires_at
       FROM field_groups
       WHERE campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
    )
    .bind(campaignId, now)
    .all<ExpiringGroupRow>();

  for (const group of expiring.results) {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE field_groups
           SET state = 'expired', closed_at = hard_expires_at, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND state = 'active' AND hard_expires_at <= ?`,
        )
        .bind(now, group.id, campaignId, now),
      db
        .prepare(
          `UPDATE field_group_join_credentials
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
        )
        .bind(group.hard_expires_at, group.id, campaignId),
      db
        .prepare(
          `DELETE FROM field_group_recoverable_credentials
           WHERE credential_id IN (
             SELECT id FROM field_group_join_credentials
             WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NOT NULL
           )`,
        )
        .bind(group.id, campaignId),
    ]);
    if ((result[0]?.meta?.changes ?? 0) === 1) {
      emitFieldGroupAudit({
        kind: "field_group.expired",
        campaignId,
        groupId: group.id,
        teamId: group.team_id,
        actorKind: "system",
        at: group.hard_expires_at,
      });
    }
  }
}

async function loadGroupRow(db: D1DatabaseLike, campaignId: string, groupId: string) {
  return db
    .prepare(
      `SELECT
         g.id, g.campaign_id, g.team_id, g.label, g.mode, g.discoverable, g.state,
         g.participant_count, g.created_at, g.hard_expires_at, g.closed_at, g.updated_at,
         t.name AS team_name, t.color AS team_color,
         CASE WHEN EXISTS (
           SELECT 1 FROM field_group_join_credentials c
           WHERE c.group_id = g.id AND c.campaign_id = g.campaign_id AND c.revoked_at IS NULL
         ) THEN 1 ELSE 0 END AS join_available,
         (
           SELECT COUNT(*) FROM field_group_memberships m
           WHERE m.group_id = g.id AND m.campaign_id = g.campaign_id
             AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ) AS membership_count
       FROM field_groups g
       JOIN teams t ON t.id = g.team_id AND t.campaign_id = g.campaign_id
       WHERE g.id = ? AND g.campaign_id = ?
       LIMIT 1`,
    )
    .bind(new Date().toISOString(), groupId, campaignId)
    .first<FieldGroupRow>();
}

async function loadCreateRequest(
  db: D1DatabaseLike,
  campaignId: string,
  requestId: string,
) {
  return db
    .prepare(
      `SELECT id, create_payload_hash
       FROM field_groups
       WHERE campaign_id = ? AND create_request_id = ?
       LIMIT 1`,
    )
    .bind(campaignId, requestId)
    .first<CreateRequestRow>();
}

async function loadCredentialRequest(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  issuanceType: CredentialIssuanceType,
  requestId: string,
) {
  return db
    .prepare(
      `SELECT id
       FROM field_group_join_credentials
       WHERE campaign_id = ? AND group_id = ? AND issuance_type = ? AND request_id = ?
       LIMIT 1`,
    )
    .bind(campaignId, groupId, issuanceType, requestId)
    .first<CredentialRequestRow>();
}

async function listDiscoverableGroups(db: D1DatabaseLike, campaignId: string) {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `SELECT
         g.id, g.campaign_id, g.team_id, g.label, g.mode, g.discoverable, g.state,
         g.participant_count, g.created_at, g.hard_expires_at, g.closed_at, g.updated_at,
         t.name AS team_name, t.color AS team_color,
         CASE WHEN EXISTS (
           SELECT 1 FROM field_group_join_credentials c
           WHERE c.group_id = g.id AND c.campaign_id = g.campaign_id AND c.revoked_at IS NULL
         ) THEN 1 ELSE 0 END AS join_available,
         (
           SELECT COUNT(*) FROM field_group_memberships m
           WHERE m.group_id = g.id AND m.campaign_id = g.campaign_id
             AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ) AS membership_count
       FROM field_groups g
       JOIN teams t ON t.id = g.team_id AND t.campaign_id = g.campaign_id
       WHERE g.campaign_id = ? AND g.state = 'active' AND g.discoverable = 1
       ORDER BY g.created_at DESC, g.id DESC`,
    )
    .bind(now, campaignId)
    .all<FieldGroupRow>();
  return result.results;
}

async function credentialPair() {
  const roomCode = generateFieldGroupRoomCode();
  const qrToken = randomSecret();
  return {
    roomCode,
    qrToken,
    roomCodeHash: await hashSecret(roomCode),
    qrTokenHash: await hashSecret(qrToken),
  };
}

async function requireCampaignAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
) {
  const access = await resolveAccess(db, request, campaignId);
  if (!access) {
    return {
      ok: false as const,
      response: errorResponse(401, "access_required", "Gültiger Zugriff ist erforderlich."),
    };
  }
  return { ok: true as const, access };
}

async function createReplayResponse(
  db: D1DatabaseLike,
  campaignId: string,
  requestId: string,
  payloadHash: string,
) {
  const replay = await loadCreateRequest(db, campaignId, requestId);
  if (!replay) return null;
  if (replay.create_payload_hash !== payloadHash) {
    return errorResponse(
      409,
      "idempotency_key_reused",
      "Diese Request-ID wurde bereits für andere Gruppendaten verwendet.",
    );
  }
  const stored = await loadGroupRow(db, campaignId, replay.id);
  if (!stored) return errorResponse(500, "group_read_failed", "Gruppe konnte nicht geladen werden.");
  return json({
    group: groupPublic(stored),
    credentials: null,
    alreadyApplied: true,
  });
}

async function createGroup(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  recoveryKey: string | undefined,
) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const label = normalizeLabel(parsed.value.label);
  const teamId = typeof parsed.value.teamId === "string" ? parsed.value.teamId : "";
  const mode = parsed.value.mode === undefined ? "distribution" : parsed.value.mode;
  const discoverable = parsed.value.discoverable === undefined ? true : parsed.value.discoverable;
  const participantCount = parsed.value.participantCount ?? null;
  const requestId = parsed.value.requestId;

  if (
    !label ||
    !validSelector(teamId) ||
    !validMode(mode) ||
    typeof discoverable !== "boolean" ||
    !validRequestId(requestId)
  ) {
    return errorResponse(400, "invalid_group", "Gruppendaten oder Request-ID sind ungültig.");
  }
  if (participantCount !== null && !validParticipantCount(participantCount)) {
    return errorResponse(400, "invalid_participant_count", "Teilnehmerzahl ist ungültig.");
  }
  const team = await teamRow(db, campaignId, teamId);
  if (!team) return errorResponse(400, "invalid_team", "Team gehört nicht zu dieser Aktion.");
  if (!canManageTeam(access, teamId)) {
    return errorResponse(403, "group_manage_forbidden", "Diese Rolle darf hier keine Gruppe erstellen.");
  }

  const payloadHash = await hashSecret(
    JSON.stringify({ teamId, label, mode, discoverable, participantCount }),
  );
  const replay = await createReplayResponse(db, campaignId, requestId, payloadHash);
  if (replay) return replay;

  const credentials = await credentialPair();
  const groupId = `field_group_${crypto.randomUUID()}`;
  const roomCredentialId = `field_group_credential_${crypto.randomUUID()}`;
  const qrCredentialId = `field_group_credential_${crypto.randomUUID()}`;
  const createdAt = new Date().toISOString();
  const hardExpiresAt = new Date(Date.parse(createdAt) + LIVE_GROUP_MAX_LIFETIME_MS).toISOString();
  const roomRecovery = await encryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: roomCredentialId, kind: "room-code" },
    credentials.roomCode,
  );
  const qrRecovery = await encryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: qrCredentialId, kind: "qr" },
    credentials.qrToken,
  );

  try {
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO field_groups
            (id, campaign_id, team_id, label, mode, discoverable, state, participant_count,
             created_by_grant_id, create_request_id, create_payload_hash,
             created_at, hard_expires_at, closed_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        .bind(
          groupId,
          campaignId,
          teamId,
          label,
          mode,
          discoverable ? 1 : 0,
          participantCount,
          access.grantId,
          requestId,
          payloadHash,
          createdAt,
          hardExpiresAt,
          createdAt,
        ),
      db
        .prepare(
          `INSERT INTO field_group_join_credentials
            (id, campaign_id, group_id, kind, issuance_type, request_id, secret_hash, created_at, revoked_at)
           VALUES (?, ?, ?, 'room-code', 'create', ?, ?, ?, NULL)`,
        )
        .bind(
          roomCredentialId,
          campaignId,
          groupId,
          requestId,
          credentials.roomCodeHash,
          createdAt,
        ),
      db
        .prepare(
          `INSERT INTO field_group_join_credentials
            (id, campaign_id, group_id, kind, issuance_type, request_id, secret_hash, created_at, revoked_at)
           VALUES (?, ?, ?, 'qr', 'create', ?, ?, ?, NULL)`,
        )
        .bind(
          qrCredentialId,
          campaignId,
          groupId,
          requestId,
          credentials.qrTokenHash,
          createdAt,
        ),
      db
        .prepare(
          `INSERT INTO field_group_recoverable_credentials
            (credential_id, campaign_id, group_id, kind, key_version, iv_b64, ciphertext_b64, created_at)
           VALUES (?, ?, ?, 'room-code', 1, ?, ?, ?)`,
        )
        .bind(roomCredentialId, campaignId, groupId, roomRecovery.ivB64, roomRecovery.ciphertextB64, createdAt),
      db
        .prepare(
          `INSERT INTO field_group_recoverable_credentials
            (credential_id, campaign_id, group_id, kind, key_version, iv_b64, ciphertext_b64, created_at)
           VALUES (?, ?, ?, 'qr', 1, ?, ?, ?)`,
        )
        .bind(qrCredentialId, campaignId, groupId, qrRecovery.ivB64, qrRecovery.ciphertextB64, createdAt),
    ]);

    if ((result[0]?.meta?.changes ?? 0) !== 1) {
      const persisted = await loadCreateRequest(db, campaignId, requestId);
      if (persisted?.create_payload_hash === payloadHash && persisted.id === groupId) {
        // D1 can omit batch metadata although the committed row is visible. This request
        // still owns the freshly generated one-time credentials, so complete normally.
      } else {
        const concurrentReplay = await createReplayResponse(db, campaignId, requestId, payloadHash);
        if (concurrentReplay) return concurrentReplay;
        return errorResponse(409, "group_create_conflict", "Gruppe konnte nicht erstellt werden.");
      }
    }
  } catch (error) {
    const concurrentReplay = await createReplayResponse(db, campaignId, requestId, payloadHash);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }

  const actor = auditActor(access);
  emitFieldGroupAudit({
    kind: "field_group.created",
    campaignId,
    groupId,
    teamId,
    ...actor,
    at: createdAt,
  });

  const stored = await loadGroupRow(db, campaignId, groupId);
  if (!stored) return errorResponse(500, "group_read_failed", "Gruppe konnte nicht geladen werden.");
  return json(
    {
      group: groupPublic(stored),
      credentials: { roomCode: credentials.roomCode, qrToken: credentials.qrToken },
      alreadyApplied: false,
    },
    { status: 201 },
  );
}

async function listManagedGroups(
  db: D1DatabaseLike,
  campaignId: string,
  teamId: string | null,
) {
  const now = new Date().toISOString();
  const teamClause = teamId ? "AND g.team_id = ?" : "";
  const result = await db
    .prepare(
      `SELECT
         g.id, g.campaign_id, g.team_id, g.label, g.mode, g.discoverable, g.state,
         g.participant_count, g.created_at, g.hard_expires_at, g.closed_at, g.updated_at,
         t.name AS team_name, t.color AS team_color,
         CASE WHEN EXISTS (
           SELECT 1 FROM field_group_join_credentials c
           WHERE c.group_id = g.id AND c.campaign_id = g.campaign_id AND c.revoked_at IS NULL
         ) THEN 1 ELSE 0 END AS join_available,
         (
           SELECT COUNT(*) FROM field_group_memberships m
           WHERE m.group_id = g.id AND m.campaign_id = g.campaign_id
             AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ) AS membership_count
       FROM field_groups g
       JOIN teams t ON t.id = g.team_id AND t.campaign_id = g.campaign_id
       WHERE g.campaign_id = ? AND g.state = 'active' AND g.hard_expires_at > ? ${teamClause}
       ORDER BY g.created_at DESC, g.id DESC`,
    )
    .bind(now, campaignId, now, ...(teamId ? [teamId] : []))
    .all<FieldGroupRow>();
  return result.results;
}

async function listGroups(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  teamFilter: string | null,
) {
  const now = new Date().toISOString();
  await expireCampaignGroups(db, campaignId, now);
  if (teamFilter && !validSelector(teamFilter)) {
    return errorResponse(400, "invalid_team_filter", "Team-Filter ist ungültig.");
  }

  if (access.role === "field-group-member") {
    if (!access.groupId || !access.teamId) return json({ groups: [] });
    if (teamFilter && teamFilter !== access.teamId) {
      return errorResponse(403, "group_scope_forbidden", "Dieser Team-Filter liegt außerhalb deines Zugriffs.");
    }
    const group = await loadGroupRow(db, campaignId, access.groupId);
    return json({ groups: group ? [groupPublic(group)] : [] });
  }

  if (access.role === "team-editor") {
    if (!access.teamId) return errorResponse(403, "editor_team_scope_missing", "Team-Scope fehlt.");
    if (teamFilter && teamFilter !== access.teamId) {
      return errorResponse(403, "group_scope_forbidden", "Dieser Team-Filter liegt außerhalb deines Zugriffs.");
    }
    const groups = await listManagedGroups(db, campaignId, access.teamId);
    return json({ groups: groups.map(groupPublic) });
  }

  if (access.role === "viewer") {
    if (access.teamId && teamFilter && teamFilter !== access.teamId) {
      return errorResponse(403, "group_scope_forbidden", "Dieser Team-Filter liegt außerhalb deines Zugriffs.");
    }
    let groups = await listDiscoverableGroups(db, campaignId);
    const scopedTeam = access.teamId ?? teamFilter;
    if (scopedTeam) groups = groups.filter((group) => group.team_id === scopedTeam);
    return json({ groups: groups.map(groupPublic) });
  }

  const groups = await listManagedGroups(db, campaignId, teamFilter);
  return json({ groups: groups.map(groupPublic) });
}

async function getGroup(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
) {
  await expireCampaignGroups(db, campaignId, new Date().toISOString());
  if (access.role === "field-group-member" && access.groupId !== groupId) {
    return errorResponse(403, "group_scope_forbidden", "Diese Gruppe liegt außerhalb deines Zugriffs.");
  }
  const group = await loadGroupRow(db, campaignId, groupId);
  if (!group) return errorResponse(404, "group_not_found", "Gruppe wurde nicht gefunden.");
  return json({ group: groupPublic(group) });
}

async function requireManagedGroup(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
  options: { allowInactive?: boolean } = {},
) {
  await expireCampaignGroups(db, campaignId, new Date().toISOString());
  const group = await loadGroupRow(db, campaignId, groupId);
  if (!group) {
    return { ok: false as const, response: errorResponse(404, "group_not_found", "Gruppe wurde nicht gefunden.") };
  }
  if (!canManageTeam(access, group.team_id)) {
    return {
      ok: false as const,
      response: errorResponse(403, "group_manage_forbidden", "Diese Rolle darf die Gruppe nicht verwalten."),
    };
  }
  if (!options.allowInactive && group.state !== "active") {
    return {
      ok: false as const,
      response: errorResponse(409, "group_not_active", "Gruppe ist nicht mehr aktiv."),
    };
  }
  return { ok: true as const, group };
}

async function patchGroup(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access);
  if (!managed.ok) return managed.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const hasDiscoverable = Object.hasOwn(parsed.value, "discoverable");
  const hasParticipantCount = Object.hasOwn(parsed.value, "participantCount");
  if (!hasDiscoverable && !hasParticipantCount) {
    return errorResponse(400, "invalid_update", "Keine unterstützte Gruppenänderung angegeben.");
  }
  if (hasDiscoverable && typeof parsed.value.discoverable !== "boolean") {
    return errorResponse(400, "invalid_discoverability", "Sichtbarkeit ist ungültig.");
  }
  if (hasParticipantCount && !validParticipantCount(parsed.value.participantCount)) {
    return errorResponse(400, "invalid_participant_count", "Teilnehmerzahl ist ungültig.");
  }

  const targetDiscoverable = hasDiscoverable ? (parsed.value.discoverable ? 1 : 0) : null;
  const targetParticipantCount = hasParticipantCount ? (parsed.value.participantCount as number) : null;
  const discoverabilityChanged =
    hasDiscoverable && managed.group.discoverable !== targetDiscoverable;
  const participantChanged =
    hasParticipantCount && managed.group.participant_count !== targetParticipantCount;

  if (!discoverabilityChanged && !participantChanged) {
    return json({ group: groupPublic(managed.group), alreadyApplied: true });
  }

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let discoverabilityIndex = -1;
  let participantIndex = -1;

  if (discoverabilityChanged && targetDiscoverable !== null) {
    discoverabilityIndex = statements.length;
    statements.push(
      db
        .prepare(
          `UPDATE field_groups
           SET discoverable = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND state = 'active' AND discoverable <> ?`,
        )
        .bind(targetDiscoverable, now, groupId, campaignId, targetDiscoverable),
    );
  }
  if (participantChanged && targetParticipantCount !== null) {
    participantIndex = statements.length;
    statements.push(
      db
        .prepare(
          `UPDATE field_groups
           SET participant_count = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND state = 'active'
             AND (participant_count IS NULL OR participant_count <> ?)`,
        )
        .bind(
          targetParticipantCount,
          now,
          groupId,
          campaignId,
          targetParticipantCount,
        ),
    );
  }

  const results = await db.batch(statements);
  const actor = auditActor(access);
  if (
    discoverabilityIndex >= 0 &&
    (results[discoverabilityIndex]?.meta?.changes ?? 0) === 1
  ) {
    emitFieldGroupAudit({
      kind: "field_group.discoverability_changed",
      campaignId,
      groupId,
      teamId: managed.group.team_id,
      ...actor,
      at: now,
    });
  }
  if (participantIndex >= 0 && (results[participantIndex]?.meta?.changes ?? 0) === 1) {
    emitFieldGroupAudit({
      kind: "field_group.participant_count_changed",
      campaignId,
      groupId,
      teamId: managed.group.team_id,
      ...actor,
      at: now,
    });
  }

  const stored = await loadGroupRow(db, campaignId, groupId);
  if (!stored) return errorResponse(404, "group_not_found", "Gruppe wurde nicht gefunden.");
  return json({
    group: groupPublic(stored),
    alreadyApplied: results.every((result) => (result.meta?.changes ?? 0) === 0),
  });
}

async function rotateCredentials(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
  recoveryKey: string | undefined,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access);
  if (!managed.ok) return managed.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const requestId = parsed.value.requestId;
  if (!validRequestId(requestId)) {
    return errorResponse(400, "invalid_request_id", "Request-ID für Rotation ist ungültig.");
  }

  if (await loadCredentialRequest(db, campaignId, groupId, "rotate", requestId)) {
    const stored = await loadGroupRow(db, campaignId, groupId);
    return json({
      group: groupPublic(stored ?? managed.group),
      credentials: null,
      alreadyApplied: true,
    });
  }

  const credentials = await credentialPair();
  const roomCredentialId = `field_group_credential_${crypto.randomUUID()}`;
  const qrCredentialId = `field_group_credential_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const roomRecovery = await encryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: roomCredentialId, kind: "room-code" },
    credentials.roomCode,
  );
  const qrRecovery = await encryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: qrCredentialId, kind: "qr" },
    credentials.qrToken,
  );
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE field_group_join_credentials
           SET revoked_at = COALESCE(revoked_at, ?)
           WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
        )
        .bind(now, groupId, campaignId),
      db
        .prepare(
          `DELETE FROM field_group_recoverable_credentials
           WHERE credential_id IN (
             SELECT id FROM field_group_join_credentials
             WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NOT NULL
           )`,
        )
        .bind(groupId, campaignId),
      db
        .prepare(
          `INSERT INTO field_group_join_credentials
            (id, campaign_id, group_id, kind, issuance_type, request_id, secret_hash, created_at, revoked_at)
           VALUES (?, ?, ?, 'room-code', 'rotate', ?, ?, ?, NULL)`,
        )
        .bind(
          roomCredentialId,
          campaignId,
          groupId,
          requestId,
          credentials.roomCodeHash,
          now,
        ),
      db
        .prepare(
          `INSERT INTO field_group_join_credentials
            (id, campaign_id, group_id, kind, issuance_type, request_id, secret_hash, created_at, revoked_at)
           VALUES (?, ?, ?, 'qr', 'rotate', ?, ?, ?, NULL)`,
        )
        .bind(
          qrCredentialId,
          campaignId,
          groupId,
          requestId,
          credentials.qrTokenHash,
          now,
        ),
      db
        .prepare(
          `INSERT INTO field_group_recoverable_credentials
            (credential_id, campaign_id, group_id, kind, key_version, iv_b64, ciphertext_b64, created_at)
           VALUES (?, ?, ?, 'room-code', 1, ?, ?, ?)`,
        )
        .bind(roomCredentialId, campaignId, groupId, roomRecovery.ivB64, roomRecovery.ciphertextB64, now),
      db
        .prepare(
          `INSERT INTO field_group_recoverable_credentials
            (credential_id, campaign_id, group_id, kind, key_version, iv_b64, ciphertext_b64, created_at)
           VALUES (?, ?, ?, 'qr', 1, ?, ?, ?)`,
        )
        .bind(qrCredentialId, campaignId, groupId, qrRecovery.ivB64, qrRecovery.ciphertextB64, now),
    ]);
  } catch (error) {
    if (await loadCredentialRequest(db, campaignId, groupId, "rotate", requestId)) {
      const stored = await loadGroupRow(db, campaignId, groupId);
      return json({
        group: groupPublic(stored ?? managed.group),
        credentials: null,
        alreadyApplied: true,
      });
    }
    throw error;
  }

  emitFieldGroupAudit({
    kind: "field_group.credentials_rotated",
    campaignId,
    groupId,
    teamId: managed.group.team_id,
    ...auditActor(access),
    at: now,
  });
  const stored = await loadGroupRow(db, campaignId, groupId);
  return json({
    group: groupPublic(stored ?? managed.group),
    credentials: { roomCode: credentials.roomCode, qrToken: credentials.qrToken },
    alreadyApplied: false,
  });
}


async function revealCredentials(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
  recoveryKey: string | undefined,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access);
  if (!managed.ok) return managed.response;
  const result = await db
    .prepare(
      `SELECT c.id AS credential_id, c.kind, r.iv_b64, r.ciphertext_b64
       FROM field_group_join_credentials c
       JOIN field_group_recoverable_credentials r ON r.credential_id = c.id
       WHERE c.campaign_id = ? AND c.group_id = ? AND c.revoked_at IS NULL
       ORDER BY c.kind ASC`,
    )
    .bind(campaignId, groupId)
    .all<RecoverableCredentialRow>();
  const room = result.results.find((row) => row.kind === "room-code") ?? null;
  const qr = result.results.find((row) => row.kind === "qr") ?? null;
  if (!room || !qr || result.results.length !== 2) {
    return errorResponse(
      409,
      "credential_recovery_unavailable",
      "Aktueller Join-Zugang ist für diesen Room nicht wiederanzeigbar.",
    );
  }
  const roomCode = await decryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: room.credential_id, kind: "room-code" },
    { ivB64: room.iv_b64, ciphertextB64: room.ciphertext_b64 },
  );
  const qrToken = await decryptFieldGroupCredential(
    recoveryKey,
    { campaignId, groupId, credentialId: qr.credential_id, kind: "qr" },
    { ivB64: qr.iv_b64, ciphertextB64: qr.ciphertext_b64 },
  );
  if (!canonicalizeFieldGroupRoomCode(roomCode) || !canonicalizeFieldGroupQrToken(qrToken)) {
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_failed",
      "Entschlüsseltes Credential ist ungültig.",
    );
  }
  return json({ credentials: { roomCode, qrToken } });
}

async function revokeCredentials(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access);
  if (!managed.ok) return managed.response;
  const now = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `UPDATE field_group_join_credentials
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, groupId, campaignId),
    db
      .prepare(
        `DELETE FROM field_group_recoverable_credentials
         WHERE credential_id IN (
           SELECT id FROM field_group_join_credentials
           WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NOT NULL
         )`,
      )
      .bind(groupId, campaignId),
  ]);
  const changed = (results[0]?.meta?.changes ?? 0) > 0;
  if (changed) {
    emitFieldGroupAudit({
      kind: "field_group.credentials_revoked",
      campaignId,
      groupId,
      teamId: managed.group.team_id,
      ...auditActor(access),
      at: now,
    });
  }
  const stored = await loadGroupRow(db, campaignId, groupId);
  return json({
    group: stored ? groupPublic(stored) : null,
    alreadyApplied: !changed,
  });
}

function tourSummaryFromGroup(group: FieldGroupRow) {
  if (!group.closed_at || !validParticipantCount(group.participant_count)) return null;
  const durationSeconds = Math.max(
    0,
    Math.floor((Date.parse(group.closed_at) - Date.parse(group.created_at)) / 1000),
  );
  return {
    startedAt: group.created_at,
    endedAt: group.closed_at,
    participantCount: group.participant_count,
    durationSeconds,
    personSeconds: durationSeconds * group.participant_count,
  };
}

async function closeGroup(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access, {
    allowInactive: true,
  });
  if (!managed.ok) return managed.response;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const suppliedParticipantCount = Object.hasOwn(parsed.value, "participantCount")
    ? parsed.value.participantCount
    : null;

  if (managed.group.state === "closed") {
    if (
      suppliedParticipantCount !== null &&
      (!validParticipantCount(suppliedParticipantCount) ||
        suppliedParticipantCount !== managed.group.participant_count)
    ) {
      return errorResponse(
        409,
        "close_conflict",
        "Die Gruppe wurde bereits mit einer anderen finalen Teilnehmerzahl geschlossen.",
      );
    }
    const summary = tourSummaryFromGroup(managed.group);
    if (!summary) return errorResponse(500, "group_close_state_invalid", "Abschlussdaten sind ungültig.");
    return json({
      group: groupPublic(managed.group),
      tourSummary: summary,
      alreadyApplied: true,
    });
  }

  if (managed.group.state !== "active") {
    return errorResponse(409, "group_not_active", "Gruppe ist nicht mehr aktiv.");
  }

  const finalParticipantCount =
    suppliedParticipantCount ?? managed.group.participant_count;
  if (!validParticipantCount(finalParticipantCount)) {
    return errorResponse(
      422,
      "final_participant_count_required",
      "Zum Schließen ist eine finale Teilnehmerzahl erforderlich.",
    );
  }

  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE field_groups
         SET state = 'closed', participant_count = ?, closed_at = ?, updated_at = ?
         WHERE id = ? AND campaign_id = ? AND state = 'active'`,
      )
      .bind(finalParticipantCount, now, now, groupId, campaignId),
    db
      .prepare(
        `UPDATE field_group_join_credentials
         SET revoked_at = COALESCE(revoked_at, ?)
         WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, groupId, campaignId),
    db
      .prepare(
        `DELETE FROM field_group_recoverable_credentials
         WHERE credential_id IN (
           SELECT id FROM field_group_join_credentials
           WHERE group_id = ? AND campaign_id = ? AND revoked_at IS NOT NULL
         )`,
      )
      .bind(groupId, campaignId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    const concurrent = await loadGroupRow(db, campaignId, groupId);
    if (concurrent?.state === "closed") {
      const summary = tourSummaryFromGroup(concurrent);
      if (summary && summary.participantCount === finalParticipantCount) {
        return json({
          group: groupPublic(concurrent),
          tourSummary: summary,
          alreadyApplied: true,
        });
      }
    }
    return errorResponse(409, "group_not_active", "Gruppe ist nicht mehr aktiv.");
  }

  const actor = auditActor(access);
  if (managed.group.participant_count !== finalParticipantCount) {
    emitFieldGroupAudit({
      kind: "field_group.participant_count_changed",
      campaignId,
      groupId,
      teamId: managed.group.team_id,
      ...actor,
      at: now,
    });
  }
  emitFieldGroupAudit({
    kind: "field_group.closed",
    campaignId,
    groupId,
    teamId: managed.group.team_id,
    ...actor,
    at: now,
  });

  const stored = await loadGroupRow(db, campaignId, groupId);
  const summary = stored ? tourSummaryFromGroup(stored) : null;
  if (!stored || !summary) {
    return errorResponse(500, "group_close_state_invalid", "Abschlussdaten konnten nicht geladen werden.");
  }
  return json({
    group: groupPublic(stored),
    tourSummary: summary,
    alreadyApplied: false,
  });
}

async function findCredentialGroup(
  db: D1DatabaseLike,
  campaignId: string,
  kind: CredentialKind,
  secretHash: string,
) {
  return db
    .prepare(
      `SELECT
         c.id AS credential_id,
         g.id, g.campaign_id, g.team_id, g.label, g.mode, g.discoverable, g.state,
         g.participant_count, g.created_at, g.hard_expires_at, g.closed_at, g.updated_at,
         t.name AS team_name, t.color AS team_color,
         1 AS join_available,
         (
           SELECT COUNT(*) FROM field_group_memberships m
           WHERE m.group_id = g.id AND m.campaign_id = g.campaign_id
             AND m.left_at IS NULL AND m.removed_at IS NULL AND m.expires_at > ?
         ) AS membership_count
       FROM field_group_join_credentials c
       JOIN field_groups g ON g.id = c.group_id AND g.campaign_id = c.campaign_id
       JOIN teams t ON t.id = g.team_id AND t.campaign_id = g.campaign_id
       WHERE c.campaign_id = ? AND c.kind = ? AND c.secret_hash = ?
         AND c.revoked_at IS NULL AND g.state = 'active' AND g.hard_expires_at > ?
       LIMIT 1`,
    )
    .bind(new Date().toISOString(), campaignId, kind, secretHash, new Date().toISOString())
    .first<CredentialGroupRow>();
}

async function persistentMembership(
  db: D1DatabaseLike,
  group: CredentialGroupRow,
  access: AccessContext,
) {
  const existing = await db
    .prepare(
      `SELECT id, campaign_id, group_id, team_id, campaign_grant_id, joined_at, expires_at, left_at, removed_at
       FROM field_group_memberships
       WHERE group_id = ? AND campaign_id = ? AND campaign_grant_id = ?
       LIMIT 1`,
    )
    .bind(group.id, group.campaign_id, access.grantId)
    .first<MembershipRow>();
  const joinedAt = new Date().toISOString();

  if (
    existing &&
    !existing.left_at &&
    !existing.removed_at &&
    existing.expires_at > joinedAt
  ) {
    return {
      membershipId: existing.id,
      joinedAt: existing.joined_at,
      alreadyJoined: true,
    };
  }

  if (existing) {
    await db.batch([
      db
        .prepare(
          `UPDATE field_group_memberships
           SET joined_at = ?, expires_at = ?, left_at = NULL, removed_at = NULL
           WHERE id = ? AND group_id = ? AND campaign_id = ?`,
        )
        .bind(joinedAt, group.hard_expires_at, existing.id, group.id, group.campaign_id),
    ]);
    return { membershipId: existing.id, joinedAt, alreadyJoined: false };
  }

  const membershipId = `field_group_membership_${crypto.randomUUID()}`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO field_group_memberships
          (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
           joined_at, expires_at, left_at, removed_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL)`,
      )
      .bind(
        membershipId,
        group.campaign_id,
        group.id,
        group.team_id,
        access.grantId,
        joinedAt,
        group.hard_expires_at,
      ),
  ]);
  return { membershipId, joinedAt, alreadyJoined: false };
}

async function temporaryMembership(db: D1DatabaseLike, group: CredentialGroupRow) {
  const membershipId = `field_group_membership_${crypto.randomUUID()}`;
  const sessionSecret = randomSecret();
  const sessionHash = await hashSecret(sessionSecret);
  const joinedAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO field_group_memberships
          (id, campaign_id, group_id, team_id, campaign_grant_id, temp_session_hash,
           joined_at, expires_at, left_at, removed_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        membershipId,
        group.campaign_id,
        group.id,
        group.team_id,
        sessionHash,
        joinedAt,
        group.hard_expires_at,
      ),
  ]);
  return { membershipId, sessionSecret, joinedAt };
}

async function membershipById(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  membershipId: string,
) {
  return db
    .prepare(
      `SELECT id, campaign_id, group_id, team_id, campaign_grant_id, joined_at, expires_at, left_at, removed_at
       FROM field_group_memberships
       WHERE id = ? AND campaign_id = ? AND group_id = ?
       LIMIT 1`,
    )
    .bind(membershipId, campaignId, groupId)
    .first<MembershipRow>();
}

async function leaveMembershipById(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  membershipId: string,
  at: string,
): Promise<"left" | "already-left" | "missing"> {
  const result = await db.batch([
    db
      .prepare(
        `UPDATE field_group_memberships
         SET left_at = ?
         WHERE id = ? AND campaign_id = ? AND group_id = ?
           AND left_at IS NULL AND removed_at IS NULL`,
      )
      .bind(at, membershipId, campaignId, groupId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) === 1) return "left";
  const existing = await membershipById(db, campaignId, groupId, membershipId);
  if (existing?.left_at) return "already-left";
  return "missing";
}

async function joinGroup(request: Request, env: FieldGroupEnv, db: D1DatabaseLike) {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const campaignId =
    typeof parsed.value.campaignId === "string" ? parseCampaignId(parsed.value.campaignId) : null;
  const kind = parsed.value.kind;
  const rawSecret = typeof parsed.value.secret === "string" ? parsed.value.secret : "";
  if (!campaignId || (kind !== "room-code" && kind !== "qr") || rawSecret.length > 256) {
    return errorResponse(400, "invalid_request", "Join-Daten sind ungültig.");
  }

  if (!env.FIELD_GROUP_JOIN_ACTOR_LIMITER || !env.FIELD_GROUP_JOIN_CREDENTIAL_LIMITER) {
    return errorResponse(
      503,
      "join_security_unconfigured",
      "Gruppenbeitritt ist serverseitig noch nicht sicher konfiguriert.",
    );
  }

  const candidate =
    kind === "room-code"
      ? canonicalizeFieldGroupRoomCode(rawSecret)
      : canonicalizeFieldGroupQrToken(rawSecret);
  const candidateForHash = candidate ?? rawSecret.trim().slice(0, 256);
  const candidateHash = await hashSecret(candidateForHash);
  const connectingIp = request.headers.get("cf-connecting-ip") ?? "unknown";

  try {
    const actorLimit = await env.FIELD_GROUP_JOIN_ACTOR_LIMITER.limit({
      key: `${campaignId}:${connectingIp}`,
    });
    if (!actorLimit.success) {
      emitFieldGroupAudit({
        kind: "field_group.join_rate_limited",
        campaignId,
        actorKind: "anonymous",
      });
      return errorResponse(429, "join_rate_limited", "Gruppenbeitritt ist vorübergehend begrenzt.");
    }

    const credentialLimit = await env.FIELD_GROUP_JOIN_CREDENTIAL_LIMITER.limit({
      key: `${campaignId}:${kind}:${candidateHash}`,
    });
    if (!credentialLimit.success) {
      emitFieldGroupAudit({
        kind: "field_group.join_rate_limited",
        campaignId,
        actorKind: "anonymous",
      });
      return errorResponse(429, "join_rate_limited", "Gruppenbeitritt ist vorübergehend begrenzt.");
    }
  } catch {
    return errorResponse(
      503,
      "join_security_unavailable",
      "Gruppenbeitritt ist vorübergehend nicht verfügbar.",
    );
  }

  await expireCampaignGroups(db, campaignId, new Date().toISOString());
  if (!candidate) {
    return errorResponse(401, "join_unavailable", "Gruppe oder Zugang ist nicht verfügbar.");
  }

  const group = await findCredentialGroup(db, campaignId, kind, candidateHash);
  if (!group) {
    return errorResponse(401, "join_unavailable", "Gruppe oder Zugang ist nicht verfügbar.");
  }

  const persistent = await resolvePersistentAccess(db, request, campaignId);
  if (persistent) {
    const membership = await persistentMembership(db, group, persistent);
    if (!membership.alreadyJoined) {
      emitFieldGroupAudit({
        kind: "field_group.joined",
        campaignId,
        groupId: group.id,
        teamId: group.team_id,
        membershipId: membership.membershipId,
        actorKind: "campaign-grant",
        actorRef: persistent.grantId,
        at: membership.joinedAt,
      });
    }
    return json({
      group: groupPublic(group),
      membership: { id: membership.membershipId, temporary: false },
      access: accessPublic(persistent),
      alreadyApplied: membership.alreadyJoined,
    });
  }

  const currentTemporary = await resolveAccess(db, request, campaignId);
  if (
    currentTemporary?.role === "field-group-member" &&
    currentTemporary.groupId === group.id &&
    currentTemporary.membershipId
  ) {
    return json({
      group: groupPublic(group),
      membership: { id: currentTemporary.membershipId, temporary: true },
      access: accessPublic(currentTemporary),
      alreadyApplied: true,
    });
  }
  if (
    currentTemporary?.role === "field-group-member" &&
    currentTemporary.groupId &&
    currentTemporary.membershipId
  ) {
    await leaveMembershipById(
      db,
      currentTemporary.campaignId,
      currentTemporary.groupId,
      currentTemporary.membershipId,
      new Date().toISOString(),
    );
  }

  const membership = await temporaryMembership(db, group);
  emitFieldGroupAudit({
    kind: "field_group.joined",
    campaignId,
    groupId: group.id,
    teamId: group.team_id,
    membershipId: membership.membershipId,
    actorKind: "temporary-member",
    actorRef: membership.membershipId,
    at: membership.joinedAt,
  });
  return json(
    {
      group: groupPublic(group),
      membership: { id: membership.membershipId, temporary: true },
      access: {
        campaignId,
        role: "field-group-member",
        teamId: group.team_id,
        groupId: group.id,
        label: group.label,
      },
      alreadyApplied: false,
    },
    { headers: { "set-cookie": fieldGroupSessionCookie(membership.sessionSecret) } },
  );
}

async function leaveGroup(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  access: AccessContext,
) {
  const now = new Date().toISOString();
  let membershipId: string | null = null;
  let clearTemporaryCookie = false;

  if (access.role === "field-group-member") {
    if (access.groupId !== groupId || !access.membershipId) {
      return errorResponse(403, "group_scope_forbidden", "Diese Gruppe liegt außerhalb deines Zugriffs.");
    }
    membershipId = access.membershipId;
    clearTemporaryCookie = true;
  } else {
    const membership = await db
      .prepare(
        `SELECT id, campaign_id, group_id, team_id, campaign_grant_id, joined_at, expires_at, left_at, removed_at
         FROM field_group_memberships
         WHERE group_id = ? AND campaign_id = ? AND campaign_grant_id = ?
         LIMIT 1`,
      )
      .bind(groupId, campaignId, access.grantId)
      .first<MembershipRow>();
    membershipId = membership?.id ?? null;
  }

  if (!membershipId) {
    return errorResponse(404, "membership_not_found", "Gruppenmitgliedschaft wurde nicht gefunden.");
  }

  const outcome = await leaveMembershipById(db, campaignId, groupId, membershipId, now);
  if (outcome === "missing") {
    return errorResponse(404, "membership_not_found", "Gruppenmitgliedschaft wurde nicht gefunden.");
  }

  if (outcome === "left") {
    const group = await loadGroupRow(db, campaignId, groupId);
    const actor = auditActor(access);
    emitFieldGroupAudit({
      kind: "field_group.member_left",
      campaignId,
      groupId,
      teamId: group?.team_id ?? access.teamId,
      membershipId,
      ...actor,
      at: now,
    });
  }

  return json(
    { ok: true, alreadyApplied: outcome === "already-left" },
    clearTemporaryCookie
      ? { headers: { "set-cookie": clearFieldGroupSessionCookie() } }
      : undefined,
  );
}

async function removeMember(
  db: D1DatabaseLike,
  campaignId: string,
  groupId: string,
  membershipId: string,
  access: AccessContext,
) {
  const managed = await requireManagedGroup(db, campaignId, groupId, access);
  if (!managed.ok) return managed.response;
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE field_group_memberships
         SET removed_at = ?
         WHERE id = ? AND campaign_id = ? AND group_id = ?
           AND left_at IS NULL AND removed_at IS NULL`,
      )
      .bind(now, membershipId, campaignId, groupId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    const existing = await membershipById(db, campaignId, groupId, membershipId);
    if (existing?.removed_at) return json({ ok: true, alreadyApplied: true });
    return errorResponse(404, "membership_not_found", "Aktive Gruppenmitgliedschaft wurde nicht gefunden.");
  }
  emitFieldGroupAudit({
    kind: "field_group.member_removed",
    campaignId,
    groupId,
    teamId: managed.group.team_id,
    membershipId,
    ...auditActor(access),
    at: now,
  });
  return json({ ok: true, alreadyApplied: false });
}

export function parseFieldGroupRoute(pathname: string): FieldGroupRoute | null {
  if (pathname === "/api/field-groups/join") return { kind: "join" };
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/field-groups(?:\/(.*))?$/u);
  if (!match) return null;

  let campaignId: string | null = null;
  try {
    campaignId = parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
  if (!campaignId) return null;
  if (!match[2]) return { kind: "collection", campaignId };

  let segments: string[];
  try {
    segments = match[2].split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  const groupId = segments[0];
  if (!validSelector(groupId)) return null;
  if (segments.length === 1) return { kind: "group", campaignId, groupId };
  if (segments.length === 2 && segments[1] === "close") {
    return { kind: "close", campaignId, groupId };
  }
  if (segments.length === 2 && segments[1] === "leave") {
    return { kind: "leave", campaignId, groupId };
  }
  if (segments.length === 3 && segments[1] === "credentials" && segments[2] === "rotate") {
    return { kind: "rotate", campaignId, groupId };
  }
  if (segments.length === 3 && segments[1] === "credentials" && segments[2] === "current") {
    return { kind: "reveal", campaignId, groupId };
  }
  if (segments.length === 3 && segments[1] === "credentials" && segments[2] === "revoke") {
    return { kind: "revoke", campaignId, groupId };
  }
  if (
    segments.length === 3 &&
    segments[1] === "memberships" &&
    validSelector(segments[2])
  ) {
    return {
      kind: "remove-member",
      campaignId,
      groupId,
      membershipId: segments[2],
    };
  }
  return null;
}

function schemaUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:no such (?:table|column)|does not exist).*field[_ ]group|field[_ ]group.*(?:no such (?:table|column)|does not exist)/iu.test(message);
}

export async function handleFieldGroupApi(
  request: Request,
  env: FieldGroupEnv,
): Promise<Response | null> {
  const route = parseFieldGroupRoute(new URL(request.url).pathname);
  if (!route) return null;
  if (!sameOriginWrite(request)) {
    return errorResponse(403, "origin_forbidden", "Cross-Origin-Schreibzugriffe sind nicht erlaubt.");
  }
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist für diesen Worker nicht gebunden.");
  const db = env.DB;

  try {
    if (route.kind === "join") {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "Für Gruppenbeitritt ist nur POST erlaubt.");
      }
      return await joinGroup(request, env, db);
    }

    if (route.kind === "leave") {
      if (request.method !== "POST") {
        return errorResponse(405, "method_not_allowed", "Für das Verlassen ist nur POST erlaubt.");
      }
      const access =
        (await resolveAccess(db, request, route.campaignId)) ??
        (await resolveFieldGroupLeaveSession(db, request, route.campaignId));
      if (!access) {
        return errorResponse(401, "access_required", "Gültiger Zugriff ist erforderlich.");
      }
      return await leaveGroup(db, route.campaignId, route.groupId, access);
    }

    const auth = await requireCampaignAccess(db, request, route.campaignId);
    if (!auth.ok) return auth.response;
    const access = auth.access;

    if (route.kind === "collection") {
      if (request.method === "GET") {
        return await listGroups(
          db,
          route.campaignId,
          access,
          new URL(request.url).searchParams.get("team"),
        );
      }
      if (request.method === "POST") {
        return await createGroup(request, db, route.campaignId, access, env.FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY);
      }
      return errorResponse(405, "method_not_allowed", "Methode für Gruppenliste nicht erlaubt.");
    }

    if (route.kind === "group") {
      if (request.method === "GET") {
        return await getGroup(db, route.campaignId, route.groupId, access);
      }
      if (request.method === "PATCH") {
        return await patchGroup(request, db, route.campaignId, route.groupId, access);
      }
      return errorResponse(405, "method_not_allowed", "Methode für Gruppe nicht erlaubt.");
    }

    if (route.kind === "reveal" && request.method === "GET") {
      return await revealCredentials(db, route.campaignId, route.groupId, access, env.FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY);
    }
    if (route.kind === "rotate" && request.method === "POST") {
      return await rotateCredentials(request, db, route.campaignId, route.groupId, access, env.FIELD_GROUP_CREDENTIAL_ENCRYPTION_KEY);
    }
    if (route.kind === "revoke" && request.method === "POST") {
      return await revokeCredentials(db, route.campaignId, route.groupId, access);
    }
    if (route.kind === "close" && request.method === "POST") {
      return await closeGroup(request, db, route.campaignId, route.groupId, access);
    }
    if (route.kind === "remove-member" && request.method === "DELETE") {
      return await removeMember(
        db,
        route.campaignId,
        route.groupId,
        route.membershipId,
        access,
      );
    }

    return errorResponse(405, "method_not_allowed", "Methode für Gruppenaktion nicht erlaubt.");
  } catch (error) {
    if (error instanceof FieldGroupCredentialRecoveryError) {
      return errorResponse(
        503,
        error.code,
        "Der aktuelle Join-Zugang kann serverseitig nicht sicher verarbeitet werden.",
      );
    }
    if (schemaUnavailable(error)) {
      return errorResponse(
        503,
        "field_group_schema_unavailable",
        "Field-Group-Datenbankmigration ist noch nicht angewendet.",
      );
    }
    return errorResponse(500, "field_group_failed", "Field-Group-Aktion ist fehlgeschlagen.");
  }
}

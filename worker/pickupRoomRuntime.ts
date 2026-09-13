import type { AccessContext } from "./access.ts";
import {
  getCampaignRevision,
  hasCampaignActionTypeColumn,
  hasPickupAreaRoomSchema,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { getAppliedMutation } from "./mutationRepository.ts";
import { loadPickupCapabilities } from "./pickupCapabilities.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import { PICKUP_COMPLETION_CONFIRMATION } from "../src/domain/collection.ts";

export { PICKUP_COMPLETION_CONFIRMATION } from "../src/domain/collection.ts";

type PickupRoomAction = "claim" | "join" | "release" | "complete" | "force-release";

type RoomActionInput = {
  actionId: string;
  roomId: string;
  participantId?: string;
  label?: string;
  expectedRevision?: number;
  roomUpdatedAt?: string;
  pendingSyncCount?: number;
  completenessConfirmed?: boolean;
  confirmationText?: string;
};

type RoomRow = {
  id: string;
  area_id: string;
  status: "active" | "released" | "completed" | "force-released";
  owner_collector_id: string;
  updated_at: string;
};

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const ACTION_ID_PATTERN = /^pickup_action_[A-Za-z0-9._:-]{1,200}$/u;
const MAX_BODY_BYTES = 32_000;

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function errorResponse(status: number, code: string, message: string, revision?: number | null) {
  return json({ error: { code, message }, ...(revision === undefined ? {} : { revision }) }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isActionId(value: unknown): value is string {
  return typeof value === "string" && ACTION_ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120;
}

async function readBody(request: Request): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Room-Anfrage ist zu groß.") };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Room-Anfrage ist zu groß.") };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return { ok: false, response: errorResponse(400, "invalid_request", "Room-Anfrage ist ungültig.") };
    return { ok: true, value };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json", "Room-Anfrage ist kein gültiges JSON.") };
  }
}

function actionInput(
  body: Record<string, unknown>,
  request: Request,
  action: PickupRoomAction,
): { ok: true; value: RoomActionInput } | { ok: false; response: Response } {
  const headerAction = request.headers.get("idempotency-key");
  const actionId = body.actionId ?? headerAction;
  if (!isActionId(actionId) || (headerAction !== null && headerAction !== actionId)) {
    return { ok: false, response: errorResponse(422, "invalid_action_id", "Eine gültige Idempotency-ID ist erforderlich.") };
  }
  if (!isId(body.roomId)) {
    return { ok: false, response: errorResponse(422, "invalid_room", "Room-ID ist ungültig.") };
  }
  const value: RoomActionInput = { actionId, roomId: body.roomId };
  if (action === "claim" || action === "join") {
    if (!isLabel(body.label)) return { ok: false, response: errorResponse(422, "invalid_label", "Ein Anzeigename ist erforderlich.") };
    value.label = body.label.trim().replace(/\s+/gu, " ");
    if (action === "join" && body.participantId !== undefined) {
      if (!isId(body.participantId)) return { ok: false, response: errorResponse(422, "invalid_participant", "Participant-ID ist ungültig.") };
      value.participantId = body.participantId;
    }
  } else if (action === "release" || action === "complete") {
    if (
      typeof body.expectedRevision !== "number" || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !isTimestamp(body.roomUpdatedAt) ||
      typeof body.pendingSyncCount !== "number" || !Number.isInteger(body.pendingSyncCount) || body.pendingSyncCount < 0 ||
      body.completenessConfirmed !== true || body.confirmationText !== PICKUP_COMPLETION_CONFIRMATION
    ) {
      return { ok: false, response: errorResponse(422, "pickup_room_confirmation_required", "Vor dem Freigeben muss der synchronisierte Bearbeitungsstand bestätigt werden.") };
    }
    value.expectedRevision = body.expectedRevision;
    value.roomUpdatedAt = body.roomUpdatedAt;
    value.pendingSyncCount = body.pendingSyncCount;
    value.completenessConfirmed = true;
    value.confirmationText = body.confirmationText;
  }
  return { ok: true, value };
}

async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function ledgerStatement(
  db: D1DatabaseLike,
  campaignId: string,
  actionId: string,
  action: PickupRoomAction,
  fingerprint: string,
  fromRevision: number,
  nextRevision: number,
  createdAt: string,
  writeToken: string,
) {
  return db.prepare(
    `INSERT INTO campaign_mutations
       (campaign_id, mutation_id, mutation_type, mutation_fingerprint,
        requested_base_revision, applied_from_revision, applied_revision, client_created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
  ).bind(
    campaignId,
    actionId,
    `collection.pickup-room.${action}`,
    fingerprint,
    fromRevision,
    fromRevision,
    nextRevision,
    createdAt,
    campaignId,
    writeToken,
  );
}

async function campaignActionType(db: D1DatabaseLike, campaignId: string) {
  if (!(await hasCampaignActionTypeColumn(db))) return null;
  const row = await db.prepare("SELECT action_type FROM campaigns WHERE id = ?").bind(campaignId).first<{ action_type: string }>();
  return row?.action_type ?? null;
}

async function activeRoom(db: D1DatabaseLike, campaignId: string, areaId: string) {
  return db.prepare(
    `SELECT id, area_id, status, owner_collector_id, updated_at
       FROM collection_rooms
      WHERE campaign_id = ? AND area_id = ? AND status = 'active'
      LIMIT 1`,
  ).bind(campaignId, areaId).first<RoomRow>();
}

async function anyRoom(db: D1DatabaseLike, campaignId: string, areaId: string, roomId: string) {
  return db.prepare(
    `SELECT id, area_id, status, owner_collector_id, updated_at
       FROM collection_rooms
      WHERE campaign_id = ? AND area_id = ? AND id = ?
      LIMIT 1`,
  ).bind(campaignId, areaId, roomId).first<RoomRow>();
}

async function areaExists(db: D1DatabaseLike, campaignId: string, areaId: string) {
  return db.prepare(
    `SELECT id, status FROM collection_areas WHERE campaign_id = ? AND id = ? LIMIT 1`,
  ).bind(campaignId, areaId).first<{ id: string; status: string }>();
}

async function activeMember(db: D1DatabaseLike, campaignId: string, roomId: string, collectorId: string) {
  return db.prepare(
    `SELECT id FROM collection_room_participants
      WHERE campaign_id = ? AND room_id = ? AND collector_id = ? AND left_at IS NULL
      LIMIT 1`,
  ).bind(campaignId, roomId, collectorId).first<{ id: string }>();
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function handlePickupRoomAction(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string,
  action: PickupRoomAction,
  access: AccessContext,
  notify?: () => Promise<unknown>,
) {
  if (!sameOrigin(request)) return errorResponse(403, "cross_origin_forbidden", "Room-Aktionen müssen same-origin erfolgen.");
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Für Room-Aktionen ist nur POST erlaubt.");
  if (!isId(campaignId) || !isId(areaId)) return errorResponse(400, "invalid_route", "Pickup Area oder Campaign ist ungültig.");

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const inputResult = actionInput(parsed.value, request, action);
  if (!inputResult.ok) return inputResult.response;
  const input = inputResult.value;

  const revision = await getCampaignRevision(db, campaignId);
  if (revision === null) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  if (!(await hasPickupAreaRoomSchema(db))) {
    return errorResponse(503, "pickup_room_schema_unavailable", "Pickup Rooms benötigen die vorbereiteten Migrationen 0024 und 0025.", revision);
  }
  if ((await campaignActionType(db, campaignId)) !== "pickup") {
    return errorResponse(409, "pickup_action_required", "Diese Campaign ist keine Pickup-Aktion.", revision);
  }

  const fingerprint = await sha256({ campaignId, areaId, action, input, actor: access.collectorId ?? null });
  const existing = await getAppliedMutation(db, campaignId, input.actionId);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) return errorResponse(409, "mutation_id_reused", "Diese Idempotency-ID wurde bereits mit anderem Inhalt verwendet.", existing.appliedRevision);
    return json({ actionId: input.actionId, roomId: input.roomId, appliedRevision: existing.appliedRevision, alreadyApplied: true });
  }

  if (action === "force-release") {
    if (access.role !== "admin") return errorResponse(403, "admin_required", "Nur Admins dürfen einen Pickup Room zwangsweise freigeben.", revision);
  } else {
    if (access.role !== "collection-collector" || !access.collectorId) {
      return errorResponse(403, "collection_scope_forbidden", "Nur ein Collection-Helfer darf Pickup Rooms bedienen.", revision);
    }
    const capabilities = await loadPickupCapabilities(db, campaignId, access.collectorId);
    if (!capabilities?.canEditPickups) {
      return errorResponse(403, "pickup_capability_forbidden", "Dieses Collection-Gerät darf Pickup-Fortschritt nicht ändern.", revision);
    }
  }

  const area = await areaExists(db, campaignId, areaId);
  if (!area) return errorResponse(404, "pickup_area_not_found", "Pickup Area wurde nicht gefunden.", revision);
  if (area.status === "archived") return errorResponse(409, "pickup_area_archived", "Archivierte Pickup Areas sind nicht verfügbar.", revision);
  if (action === "claim" && (area.status === "completed" || area.status === "archived")) {
    return errorResponse(409, "pickup_area_not_claimable", "Diese Pickup Area ist bereits abgeschlossen.", revision);
  }

  const currentRoom = await anyRoom(db, campaignId, areaId, input.roomId);
  if (action === "claim") {
    const active = await activeRoom(db, campaignId, areaId);
    if (active) return errorResponse(409, "pickup_area_already_claimed", "Diese Pickup Area wird bereits in einem Room bearbeitet.", revision);
    if (currentRoom) return errorResponse(409, "pickup_room_already_exists", "Diese Room-ID wurde bereits verwendet.", revision);
  } else {
    if (!currentRoom) return errorResponse(404, "pickup_room_not_found", "Pickup Room wurde nicht gefunden.", revision);
    if (currentRoom.status !== "active") return errorResponse(409, "pickup_room_not_active", "Pickup Room ist nicht mehr aktiv.", revision);
  }

  if (action === "join" && access.collectorId && await activeMember(db, campaignId, input.roomId, access.collectorId)) {
    return json({ actionId: input.actionId, roomId: input.roomId, appliedRevision: revision, alreadyApplied: true });
  }
  if ((action === "release" || action === "complete") && access.collectorId) {
    if (!(await activeMember(db, campaignId, input.roomId, access.collectorId))) {
      return errorResponse(403, "pickup_room_member_required", "Du bist kein aktives Mitglied dieses Rooms.", revision);
    }
    if (input.expectedRevision !== revision || input.roomUpdatedAt !== currentRoom?.updated_at) {
      return errorResponse(409, "pickup_room_changed", "Room oder Campaign wurden auf einem anderen Gerät geändert.", revision);
    }
    if (input.pendingSyncCount !== 0 || input.completenessConfirmed !== true) {
      return errorResponse(409, "pickup_room_confirmation_required", "Es müssen zuerst alle lokalen Änderungen synchronisiert und bestätigt werden.", revision);
    }
  }

  if (action === "force-release" && currentRoom?.status !== "active") {
    return errorResponse(409, "pickup_room_not_active", "Pickup Room ist nicht mehr aktiv.", revision);
  }

  const now = new Date().toISOString();
  const nextRevision = revision + 1;
  const writeToken = crypto.randomUUID();
  const campaignGuard = db.prepare(
    `UPDATE campaigns SET revision = ?, write_token = ?, updated_at = ?
      WHERE id = ? AND revision = ? AND action_type = 'pickup'`,
  ).bind(nextRevision, writeToken, now, campaignId, revision);
  const statements = [campaignGuard];

  if (action === "claim") {
    statements.push(
      db.prepare(
        `INSERT INTO collection_rooms
          (id, campaign_id, area_id, status, owner_collector_id, owner_label, created_at, updated_at, closed_at)
         SELECT ?, ?, ?, 'active', ?, ?, ?, ?, NULL
          WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(input.roomId, campaignId, areaId, access.collectorId, input.label, now, now, campaignId, writeToken),
      db.prepare(
        `INSERT INTO collection_room_participants
          (id, room_id, campaign_id, collector_id, label, joined_at, left_at)
         SELECT ?, ?, ?, ?, ?, ?, NULL
          WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(input.participantId ?? `collection_participant_${input.roomId}_${access.collectorId}`, input.roomId, campaignId, access.collectorId, input.label, now, campaignId, writeToken),
      db.prepare(
        `UPDATE collection_areas SET status = 'claimed', claimed_by_collector_id = ?, claimed_by_label = ?, completed_at = NULL, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND status IN ('open', 'claimed', 'in-progress')
            AND EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(access.collectorId, input.label, now, areaId, campaignId, campaignId, writeToken),
    );
  } else if (action === "join") {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO collection_room_participants
          (id, room_id, campaign_id, collector_id, label, joined_at, left_at)
         SELECT ?, ?, ?, ?, ?, ?, NULL
          WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(input.participantId ?? `collection_participant_${input.roomId}_${access.collectorId}`, input.roomId, campaignId, access.collectorId, input.label, now, campaignId, writeToken),
      db.prepare(
        `UPDATE collection_room_participants SET label = ?, joined_at = ?, left_at = NULL
          WHERE room_id = ? AND campaign_id = ? AND collector_id = ?
            AND EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(input.label, now, input.roomId, campaignId, access.collectorId, campaignId, writeToken),
      db.prepare(
        `UPDATE collection_rooms SET updated_at = ?
          WHERE id = ? AND campaign_id = ? AND status = 'active'
            AND EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(now, input.roomId, campaignId, campaignId, writeToken),
    );
  } else {
    const completed = action === "complete";
    const roomStatus = completed ? "completed" : action === "force-release" ? "force-released" : "released";
    statements.push(
      db.prepare(
        `UPDATE collection_rooms SET status = ?, updated_at = ?, closed_at = ?
          WHERE id = ? AND campaign_id = ? AND area_id = ? AND status = 'active'
            AND EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(roomStatus, now, now, input.roomId, campaignId, areaId, campaignId, writeToken),
      db.prepare(
        `UPDATE collection_areas SET status = ?, claimed_by_collector_id = NULL, claimed_by_label = NULL,
            completed_at = ?, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND status IN ('claimed', 'in-progress')
            AND EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      ).bind(completed ? "completed" : "open", completed ? now : null, now, areaId, campaignId, campaignId, writeToken),
    );
  }

  statements.push(
    db.prepare(
      `INSERT INTO collection_room_events
        (id, campaign_id, area_id, room_id, event_type, actor_collector_id, details_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
    ).bind(input.actionId, campaignId, areaId, input.roomId, action, access.collectorId ?? null, JSON.stringify({ confirmation: action === "release" || action === "complete", actorGrantId: access.role === "admin" ? access.grantId : null }), now, campaignId, writeToken),
    ledgerStatement(db, campaignId, input.actionId, action, fingerprint, revision, nextRevision, now, writeToken),
  );

  try {
    const results = await db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) {
      return errorResponse(409, "revision_conflict", "Der Room wurde gleichzeitig auf einem anderen Gerät geändert.", await getCampaignRevision(db, campaignId));
    }
    const response = json({ actionId: input.actionId, roomId: input.roomId, appliedRevision: nextRevision, alreadyApplied: false });
    if (notify) await notify().catch(() => undefined);
    return response;
  } catch (error) {
    const replay = await getAppliedMutation(db, campaignId, input.actionId);
    if (replay) {
      if (replay.mutationFingerprint !== fingerprint) return errorResponse(409, "mutation_id_reused", "Diese Idempotency-ID wurde bereits mit anderem Inhalt verwendet.", replay.appliedRevision);
      return json({ actionId: input.actionId, roomId: input.roomId, appliedRevision: replay.appliedRevision, alreadyApplied: true });
    }
    if (action === "claim" && await activeRoom(db, campaignId, areaId)) {
      return errorResponse(409, "pickup_area_already_claimed", "Diese Pickup Area wurde gerade von einem anderen Gerät übernommen.", await getCampaignRevision(db, campaignId));
    }
    void error;
    return errorResponse(409, "pickup_room_conflict", "Die Room-Änderung konnte wegen eines gleichzeitigen Zugriffs nicht übernommen werden.", await getCampaignRevision(db, campaignId));
  }
}

export type { PickupRoomAction };

/**
 * Section writes use the existing durable mutation endpoint, but a collector
 * still needs the Room capability and membership guard at the authoritative
 * boundary. Admin section preparation is intentionally unrestricted by Room.
 */
export async function authorizePickupSectionMutation(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  mutation: Extract<CampaignMutation, { type: `collection.pickup-section.${string}` }>,
) {
  const revision = await getCampaignRevision(db, campaignId);
  if (revision === null) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  if (!(await hasPickupAreaRoomSchema(db))) {
    return errorResponse(503, "pickup_room_schema_unavailable", "Pickup Areas benötigen die vorbereiteten Migrationen 0024 und 0025.", revision);
  }
  if ((await campaignActionType(db, campaignId)) !== "pickup") {
    return errorResponse(409, "pickup_action_required", "Diese Campaign ist keine Pickup-Aktion.", revision);
  }
  if (mutation.type === "collection.pickup-section.revert-status" && access.role !== "admin") {
    return errorResponse(403, "pickup_section_revert_admin_required", "Nur Admins dürfen Pickup-Abschnittsänderungen kompensierend zurücksetzen.", revision);
  }
  if (access.role === "admin") return null;
  if (access.role !== "collection-collector" || !access.collectorId) {
    return errorResponse(403, "pickup_section_forbidden", "Nur Admins oder aktive Pickup Room-Mitglieder dürfen Pickup-Abschnitte ändern.", revision);
  }
  if (mutation.type !== "collection.pickup-section.set-status" || !mutation.payload.roomId) {
    return errorResponse(403, "pickup_section_forbidden", "Collection-Helfer dürfen nur den Status im aktiven Room ändern.", revision);
  }
  const capabilities = await loadPickupCapabilities(db, campaignId, access.collectorId);
  if (!capabilities?.canEditPickups) {
    return errorResponse(403, "pickup_capability_forbidden", "Dieses Collection-Gerät darf Pickup-Fortschritt nicht ändern.", revision);
  }
  const room = await anyRoom(db, campaignId, mutation.payload.areaId, mutation.payload.roomId);
  if (!room || room.status !== "active" || !(await activeMember(db, campaignId, mutation.payload.roomId, access.collectorId))) {
    return errorResponse(403, "pickup_room_member_required", "Du bist kein aktives Mitglied des Pickup Rooms.", revision);
  }
  return null;
}

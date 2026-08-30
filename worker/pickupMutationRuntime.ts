import type { AccessContext } from "./access.ts";
import {
  getCampaignRevision,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "./campaignRepository.ts";
import { getAppliedMutation } from "./mutationRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  isPickupMutationType,
  type PickupMutation,
} from "../src/domain/pickupMutation.ts";
import { isPickupPosition, isPickupSource } from "../src/domain/pickup.ts";

const MAX_PERSIST_ATTEMPTS = 3;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const PICKUP_ID_PATTERN = /^collection_pickup_[A-Za-z0-9._:-]+$/u;
const PICKUP_STATUSES = new Set(["open", "collected", "unavailable", "needs-follow-up"]);

type CollectorCapabilities = {
  can_create_pickups: number;
  can_edit_pickups: number;
  can_assign_pickups: number;
};

type PickupRow = {
  id: string;
  area_id: string | null;
  updated_at: string;
  archived_at: string | null;
};

type PickupActor = {
  kind: "campaign-grant" | "collection-collector";
  ref: string | null;
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

function errorResponse(
  status: number,
  code: string,
  message: string,
  revision?: number | null,
) {
  return json(
    {
      error: { code, message },
      ...(revision !== undefined ? { revision } : {}),
    },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isPickupId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && PICKUP_ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isText(value: unknown, min: number, max: number) {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isDescription(value: unknown) {
  return typeof value === "string" && value.length <= 4_000;
}

function isUniqueIdList(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(isId) &&
    new Set(value).size === value.length
  );
}

function validCommonMutation(value: Record<string, unknown>, campaignId: string) {
  return (
    typeof value.id === "string" &&
    value.id.startsWith("mutation_") &&
    isId(value.id) &&
    value.campaignId === campaignId &&
    typeof value.baseRevision === "number" &&
    Number.isInteger(value.baseRevision) &&
    value.baseRevision >= 0 &&
    isTimestamp(value.createdAt) &&
    isPickupMutationType(value.type) &&
    isRecord(value.payload)
  );
}

export function isPickupMutationInput(value: unknown) {
  return isRecord(value) && isPickupMutationType(value.type);
}

export function validatePickupMutation(
  value: unknown,
  campaignId: string,
): { valid: true; mutation: PickupMutation } | { valid: false; message: string } {
  if (!isRecord(value) || !validCommonMutation(value, campaignId)) {
    return { valid: false, message: "Pickup-Mutation ist ungültig." };
  }
  const payload = value.payload as Record<string, unknown>;

  switch (value.type) {
    case "collection.pickup.create":
      if (
        !exactKeys(payload, [
          "pickupId",
          "areaId",
          "title",
          "address",
          "description",
          "position",
          "source",
        ]) ||
        !isPickupId(payload.pickupId) ||
        (payload.areaId !== null && !isId(payload.areaId)) ||
        !isText(payload.title, 1, 160) ||
        !isText(payload.address, 1, 320) ||
        !isDescription(payload.description) ||
        !isPickupPosition(payload.position) ||
        !isPickupSource(payload.source)
      ) break;
      return { valid: true, mutation: value as unknown as PickupMutation };
    case "collection.pickup.update":
      if (
        !exactKeys(payload, [
          "pickupId",
          "areaId",
          "title",
          "address",
          "description",
          "position",
          "expectedUpdatedAt",
        ]) ||
        !isPickupId(payload.pickupId) ||
        (payload.areaId !== null && !isId(payload.areaId)) ||
        !isText(payload.title, 1, 160) ||
        !isText(payload.address, 1, 320) ||
        !isDescription(payload.description) ||
        !isPickupPosition(payload.position) ||
        !isTimestamp(payload.expectedUpdatedAt)
      ) break;
      return { valid: true, mutation: value as unknown as PickupMutation };
    case "collection.pickup.set-status":
      if (
        !exactKeys(payload, ["pickupId", "status", "expectedUpdatedAt"]) ||
        !isPickupId(payload.pickupId) ||
        typeof payload.status !== "string" ||
        !PICKUP_STATUSES.has(payload.status) ||
        !isTimestamp(payload.expectedUpdatedAt)
      ) break;
      return { valid: true, mutation: value as unknown as PickupMutation };
    case "collection.pickup.archive":
      if (
        !exactKeys(payload, ["pickupId", "expectedUpdatedAt"]) ||
        !isPickupId(payload.pickupId) ||
        !isTimestamp(payload.expectedUpdatedAt)
      ) break;
      return { valid: true, mutation: value as unknown as PickupMutation };
    case "collection.pickup.set-assignment":
      if (
        !exactKeys(payload, [
          "pickupId",
          "assignedRunIds",
          "assignedCollectorIds",
          "expectedUpdatedAt",
        ]) ||
        !isPickupId(payload.pickupId) ||
        !isUniqueIdList(payload.assignedRunIds) ||
        !isUniqueIdList(payload.assignedCollectorIds) ||
        !isTimestamp(payload.expectedUpdatedAt)
      ) break;
      return { valid: true, mutation: value as unknown as PickupMutation };
  }

  return { valid: false, message: "Pickup-Mutation enthält ungültige oder zusätzliche Felder." };
}

export async function hasPickupSchema(db: D1DatabaseLike) {
  try {
    const [pickupColumns, collectorColumns] = await Promise.all([
      db.prepare("PRAGMA table_info(collection_pickups)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(collection_collectors)").all<{ name: string }>(),
    ]);
    const pickupNames = new Set(pickupColumns.results.map((column) => column.name));
    const collectorNames = new Set(collectorColumns.results.map((column) => column.name));
    return (
      pickupNames.has("id") &&
      pickupNames.has("assigned_run_ids_json") &&
      collectorNames.has("can_create_pickups") &&
      collectorNames.has("can_edit_pickups") &&
      collectorNames.has("can_assign_pickups")
    );
  } catch {
    return false;
  }
}

function actorForAccess(access: AccessContext): PickupActor | null {
  if (access.role === "admin") {
    return { kind: "campaign-grant", ref: access.grantId };
  }
  if (access.role === "collection-collector" && access.collectorId) {
    return { kind: "collection-collector", ref: access.collectorId };
  }
  return null;
}

async function collectorCapabilities(
  db: D1DatabaseLike,
  campaignId: string,
  collectorId: string,
) {
  return db
    .prepare(
      `SELECT can_create_pickups, can_edit_pickups, can_assign_pickups
       FROM collection_collectors
       WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL`,
    )
    .bind(collectorId, campaignId)
    .first<CollectorCapabilities>();
}

function requiredCapability(mutation: PickupMutation) {
  if (mutation.type === "collection.pickup.create") return "can_create_pickups" as const;
  if (mutation.type === "collection.pickup.set-assignment") return "can_assign_pickups" as const;
  return "can_edit_pickups" as const;
}

async function targetPickup(
  db: D1DatabaseLike,
  campaignId: string,
  pickupId: string,
) {
  return db
    .prepare(
      `SELECT id, area_id, updated_at, archived_at
       FROM collection_pickups
       WHERE id = ? AND campaign_id = ?`,
    )
    .bind(pickupId, campaignId)
    .first<PickupRow>();
}

async function validateArea(
  db: D1DatabaseLike,
  campaignId: string,
  areaId: string | null,
) {
  if (areaId === null) return true;
  const row = await db
    .prepare(
      `SELECT id FROM collection_areas
       WHERE id = ? AND campaign_id = ? AND status <> 'archived'`,
    )
    .bind(areaId, campaignId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function allReferencesExist(
  db: D1DatabaseLike,
  table: "collection_runs" | "collection_collectors",
  campaignId: string,
  ids: string[],
) {
  if (ids.length === 0) return true;
  const revokedPredicate = table === "collection_collectors" ? " AND revoked_at IS NULL" : "";
  const rows = await db
    .prepare(
      `SELECT id FROM ${table}
       WHERE campaign_id = ?${revokedPredicate}
         AND id IN (SELECT value FROM json_each(?))`,
    )
    .bind(campaignId, JSON.stringify(ids))
    .all<{ id: string }>();
  return rows.results.length === ids.length;
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function pickupStatement(
  db: D1DatabaseLike,
  mutation: PickupMutation,
  actor: PickupActor,
  writeToken: string,
): D1PreparedStatement {
  const guard = guardExistsSql();
  switch (mutation.type) {
    case "collection.pickup.create":
      return db
        .prepare(
          `INSERT INTO collection_pickups (
             id, campaign_id, area_id, title, address, description, longitude, latitude,
             status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
             source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
             created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, '[]', '[]', ?, ?, ?, ?, ?, ?, ?
           WHERE ${guard}`,
        )
        .bind(
          mutation.payload.pickupId,
          mutation.campaignId,
          mutation.payload.areaId,
          mutation.payload.title.trim().replace(/\s+/gu, " "),
          mutation.payload.address.trim().replace(/\s+/gu, " "),
          mutation.payload.description.trim(),
          mutation.payload.position[0],
          mutation.payload.position[1],
          mutation.payload.source ? JSON.stringify(mutation.payload.source) : null,
          actor.kind,
          actor.ref,
          actor.kind,
          actor.ref,
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "collection.pickup.update":
      return db
        .prepare(
          `UPDATE collection_pickups
           SET area_id = ?, title = ?, address = ?, description = ?, longitude = ?, latitude = ?,
               updated_by_kind = ?, updated_by_ref = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND updated_at = ? AND archived_at IS NULL
             AND ${guard}`,
        )
        .bind(
          mutation.payload.areaId,
          mutation.payload.title.trim().replace(/\s+/gu, " "),
          mutation.payload.address.trim().replace(/\s+/gu, " "),
          mutation.payload.description.trim(),
          mutation.payload.position[0],
          mutation.payload.position[1],
          actor.kind,
          actor.ref,
          mutation.createdAt,
          mutation.payload.pickupId,
          mutation.campaignId,
          mutation.payload.expectedUpdatedAt,
          mutation.campaignId,
          writeToken,
        );
    case "collection.pickup.set-status":
      return db
        .prepare(
          `UPDATE collection_pickups
           SET status = ?, updated_by_kind = ?, updated_by_ref = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND updated_at = ? AND archived_at IS NULL
             AND ${guard}`,
        )
        .bind(
          mutation.payload.status,
          actor.kind,
          actor.ref,
          mutation.createdAt,
          mutation.payload.pickupId,
          mutation.campaignId,
          mutation.payload.expectedUpdatedAt,
          mutation.campaignId,
          writeToken,
        );
    case "collection.pickup.archive":
      return db
        .prepare(
          `UPDATE collection_pickups
           SET archived_at = ?, updated_by_kind = ?, updated_by_ref = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND updated_at = ? AND archived_at IS NULL
             AND ${guard}`,
        )
        .bind(
          mutation.createdAt,
          actor.kind,
          actor.ref,
          mutation.createdAt,
          mutation.payload.pickupId,
          mutation.campaignId,
          mutation.payload.expectedUpdatedAt,
          mutation.campaignId,
          writeToken,
        );
    case "collection.pickup.set-assignment":
      return db
        .prepare(
          `UPDATE collection_pickups
           SET assigned_run_ids_json = ?, assigned_collector_ids_json = ?,
               updated_by_kind = ?, updated_by_ref = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND updated_at = ? AND archived_at IS NULL
             AND ${guard}`,
        )
        .bind(
          JSON.stringify(mutation.payload.assignedRunIds),
          JSON.stringify(mutation.payload.assignedCollectorIds),
          actor.kind,
          actor.ref,
          mutation.createdAt,
          mutation.payload.pickupId,
          mutation.campaignId,
          mutation.payload.expectedUpdatedAt,
          mutation.campaignId,
          writeToken,
        );
  }
}

async function currentTargetCheck(
  db: D1DatabaseLike,
  mutation: PickupMutation,
) {
  if (mutation.type === "collection.pickup.create") {
    const existing = await targetPickup(db, mutation.campaignId, mutation.payload.pickupId);
    return existing
      ? { ok: false as const, status: 409, code: "pickup_already_exists", message: "Pickup existiert bereits." }
      : { ok: true as const };
  }

  const pickup = await targetPickup(db, mutation.campaignId, mutation.payload.pickupId);
  if (!pickup) {
    return { ok: false as const, status: 404, code: "pickup_not_found", message: "Pickup wurde nicht gefunden." };
  }
  if (pickup.archived_at) {
    return { ok: false as const, status: 409, code: "pickup_archived", message: "Archivierte Pickups können nicht verändert werden." };
  }
  if (pickup.updated_at !== mutation.payload.expectedUpdatedAt) {
    return { ok: false as const, status: 409, code: "mutation_conflict", message: "Pickup wurde auf einem anderen Gerät geändert." };
  }
  return { ok: true as const };
}

function claimStatement(
  db: D1DatabaseLike,
  mutation: PickupMutation,
  currentRevision: number,
  nextRevision: number,
  writeToken: string,
  access: AccessContext,
) {
  const targetPredicate =
    mutation.type === "collection.pickup.create"
      ? "AND NOT EXISTS (SELECT 1 FROM collection_pickups WHERE id = ? AND campaign_id = ?)"
      : "AND EXISTS (SELECT 1 FROM collection_pickups WHERE id = ? AND campaign_id = ? AND updated_at = ? AND archived_at IS NULL)";
  const capability = requiredCapability(mutation);
  const collectorPredicate =
    access.role === "collection-collector"
      ? `AND EXISTS (
           SELECT 1 FROM collection_collectors
           WHERE id = ? AND campaign_id = ? AND revoked_at IS NULL AND ${capability} = 1
         )`
      : "";
  const targetBinds =
    mutation.type === "collection.pickup.create"
      ? [mutation.payload.pickupId, mutation.campaignId]
      : [mutation.payload.pickupId, mutation.campaignId, mutation.payload.expectedUpdatedAt];
  const collectorBinds =
    access.role === "collection-collector" && access.collectorId
      ? [access.collectorId, mutation.campaignId]
      : [];
  return db
    .prepare(
      `UPDATE campaigns
       SET revision = ?, write_token = ?, updated_at = ?
       WHERE id = ? AND revision = ?
         ${targetPredicate}
         ${collectorPredicate}`,
    )
    .bind(
      nextRevision,
      writeToken,
      mutation.createdAt,
      mutation.campaignId,
      currentRevision,
      ...targetBinds,
      ...collectorBinds,
    );
}

function ledgerStatement(
  db: D1DatabaseLike,
  mutation: PickupMutation,
  fingerprint: string,
  fromRevision: number,
  nextRevision: number,
  writeToken: string,
) {
  return db
    .prepare(
      `INSERT INTO campaign_mutations (
         campaign_id, mutation_id, mutation_type, mutation_fingerprint,
         requested_base_revision, applied_from_revision, applied_revision, client_created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${guardExistsSql()}`,
    )
    .bind(
      mutation.campaignId,
      mutation.id,
      mutation.type,
      fingerprint,
      mutation.baseRevision,
      fromRevision,
      nextRevision,
      mutation.createdAt,
      mutation.campaignId,
      writeToken,
    );
}

export async function handlePickupMutation(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  rawMutation: unknown,
) {
  const validation = validatePickupMutation(rawMutation, campaignId);
  if (!validation.valid) {
    return errorResponse(422, "mutation_invalid", validation.message);
  }
  const mutation = validation.mutation;
  const actor = actorForAccess(access);
  if (!actor) {
    return errorResponse(
      403,
      "collection_scope_forbidden",
      "Nur Admins oder Collection-Helfer dürfen Pickups ändern.",
    );
  }

  if (!(await hasPickupSchema(db))) {
    return errorResponse(
      503,
      "pickup_schema_unavailable",
      "Pickup-Persistenz benötigt die vorbereitete Migration 0011.",
      await getCampaignRevision(db, campaignId),
    );
  }

  if (access.role === "collection-collector") {
    if (!access.collectorId) {
      return errorResponse(403, "collection_actor_forbidden", "Collection-Gerät ist ungültig.");
    }
    const capabilities = await collectorCapabilities(db, campaignId, access.collectorId);
    if (!capabilities || capabilities[requiredCapability(mutation)] !== 1) {
      return errorResponse(
        403,
        "pickup_capability_forbidden",
        "Dieses Collection-Gerät besitzt diese Pickup-Berechtigung nicht.",
      );
    }
  }

  const areaId =
    mutation.type === "collection.pickup.create" || mutation.type === "collection.pickup.update"
      ? mutation.payload.areaId
      : null;
  if (!(await validateArea(db, campaignId, areaId))) {
    return errorResponse(422, "pickup_area_invalid", "Collection Area gehört nicht zu dieser Campaign oder ist archiviert.");
  }

  if (mutation.type === "collection.pickup.set-assignment") {
    const [runsValid, collectorsValid] = await Promise.all([
      allReferencesExist(db, "collection_runs", campaignId, mutation.payload.assignedRunIds),
      allReferencesExist(
        db,
        "collection_collectors",
        campaignId,
        mutation.payload.assignedCollectorIds,
      ),
    ]);
    if (!runsValid || !collectorsValid) {
      return errorResponse(
        422,
        "pickup_assignment_invalid",
        "Run oder Collector gehört nicht zur Campaign oder ist nicht mehr aktiv.",
      );
    }
  }

  const targetCheck = await currentTargetCheck(db, mutation);
  if (!targetCheck.ok) {
    return errorResponse(
      targetCheck.status,
      targetCheck.code,
      targetCheck.message,
      await getCampaignRevision(db, campaignId),
    );
  }

  const fingerprint = await fingerprintCampaignMutation(
    mutation as unknown as CampaignMutation,
  );
  const existing = await getAppliedMutation(db, campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) {
      return errorResponse(
        409,
        "mutation_id_reused",
        "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
        existing.appliedRevision,
      );
    }
    return json({
      mutationId: mutation.id,
      appliedRevision: existing.appliedRevision,
      alreadyApplied: true,
    });
  }

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    const fromRevision = await getCampaignRevision(db, campaignId);
    if (fromRevision === null) {
      return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
    }

    const retryTargetCheck = await currentTargetCheck(db, mutation);
    if (!retryTargetCheck.ok) {
      return errorResponse(
        retryTargetCheck.status,
        retryTargetCheck.code,
        retryTargetCheck.message,
        fromRevision,
      );
    }

    const nextRevision = fromRevision + 1;
    const writeToken = crypto.randomUUID();
    const statements = [
      claimStatement(db, mutation, fromRevision, nextRevision, writeToken, access),
      pickupStatement(db, mutation, actor, writeToken),
      ledgerStatement(db, mutation, fingerprint, fromRevision, nextRevision, writeToken),
    ];
    const results = await db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) === 1) {
      return json({
        mutationId: mutation.id,
        appliedRevision: nextRevision,
        alreadyApplied: false,
      });
    }

    const appliedAfterRace = await getAppliedMutation(db, campaignId, mutation.id);
    if (appliedAfterRace) {
      if (appliedAfterRace.mutationFingerprint !== fingerprint) {
        return errorResponse(
          409,
          "mutation_id_reused",
          "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
          appliedAfterRace.appliedRevision,
        );
      }
      return json({
        mutationId: mutation.id,
        appliedRevision: appliedAfterRace.appliedRevision,
        alreadyApplied: true,
      });
    }
  }

  return errorResponse(
    409,
    "revision_conflict",
    "Der Campaign-Stand wurde gleichzeitig auf einem anderen Gerät geändert.",
    await getCampaignRevision(db, campaignId),
  );
}

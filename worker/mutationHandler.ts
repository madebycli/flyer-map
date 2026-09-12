import {
  applyCampaignMutation,
  CampaignMutationConflictError,
} from "../src/domain/mutations.ts";
import type { AccessContext } from "./access.ts";
import { authorizeSnapshotWrite } from "./authorization.ts";
import {
  loadCampaignSnapshot,
  type CampaignSnapshotLoadOptions,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { hasFieldSessionHistorySchema } from "./fieldSessionHistory.ts";
import { buildMutationDomainEvent } from "./mutationEvents.ts";
import { buildAutomationExecution } from "./automationRuntime.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import {
  getAppliedMutation,
  persistCampaignMutation,
  teamDeleteBlocker,
} from "./mutationRepository.ts";
import { validateCampaignMutation } from "./mutationValidation.ts";
import { requestDatabase } from './requestDatabase.ts';
import { hasBaseStorage } from './streetNetwork/baseStorage.ts';
import { areaPreparationFingerprint } from './areaTaskPreparation.ts';
import { validateCampaignSnapshotWithLegacyHouseTolerance } from "./snapshotValidation.ts";
import { isPickupMutationInput } from "./pickupMutationRuntime.ts";
import { handlePickupMutationRequest } from "./pickupMutationEntry.ts";
import {
  areaHasStartedAutomaticWork,
  beginAreaTaskPreparation,
  runAreaTaskPreparation,
  type AreaPreparationExecutionContext,
  type AreaTaskPreparationOptions,
} from "./areaTaskPreparation.ts";
import { AUTO_AREA_PREPARATION_ENABLED } from "../src/domain/missionPolicy.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  hasRxdbSyncSchema,
  rxdbChangeFeedEntriesForMutation,
} from "./rxdbChangeFeed.ts";

const MAX_MUTATION_BYTES = 256_000;
const MAX_PERSIST_ATTEMPTS = 3;

function fullMutationSnapshotOptions(mutation: CampaignMutation): CampaignSnapshotLoadOptions {
  return {
    includeCollection: mutation.type.startsWith("collection."),
    houseId: mutation.type === "house.set-status" || mutation.type === "house.rename"
      ? mutation.payload.taskId
      : undefined,
  };
}

/**
 * Admin mutations that touch only campaign metadata, Teams, or Areas do not
 * need an unrelated distribution snapshot to validate or publish their own
 * feed entry. Scoped editors retain the full snapshot because authorization
 * compares their complete Team and task boundary.
 */
function mutationSnapshotOptions(
  mutation: CampaignMutation,
  access: AccessContext,
): CampaignSnapshotLoadOptions {
  const full = fullMutationSnapshotOptions(mutation);
  if (access.role !== "admin") return full;

  switch (mutation.type) {
    case "campaign.rename":
    case "campaign.set-default-map-view":
      return {
        includeCollection: false,
        includeTeams: false,
        includeAreas: false,
        includeTasks: false,
        includeHouses: false,
      };
    case "team.create":
    case "team.update":
      return {
        includeCollection: false,
        includeAreas: false,
        includeTasks: false,
        includeHouses: false,
      };
    case "team.delete":
      return {
        includeCollection: false,
        includeAreas: true,
        includeTasks: false,
        includeHouses: false,
      };
    case "area.create":
    case "area.rename":
    case "area.update-geometry":
      return {
        includeCollection: false,
        includeTasks: false,
        includeHouses: false,
      };
    default:
      return full;
  }
}

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
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

async function readMutationBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Mutation ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_MUTATION_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Mutation ist zu groß."),
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_request", "Mutation-Request ist ungültig."),
      };
    }
    return { ok: true as const, value: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON."),
    };
  }
}

export async function handleCampaignMutation(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  context?: AreaPreparationExecutionContext,
  options?: AreaTaskPreparationOptions,
) {
  db=requestDatabase(db);
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Für Mutationen ist nur POST erlaubt.");
  }
  if (access.role === "viewer") {
    return errorResponse(403, "viewer_read_only", "Read-only Viewer dürfen nichts verändern.");
  }

  const parsed = await readMutationBody(request);
  if (!parsed.ok) return parsed.response;

  if (isPickupMutationInput(parsed.value.mutation)) {
    return handlePickupMutationRequest(db, campaignId, access, parsed.value.mutation);
  }

  const validation = validateCampaignMutation(parsed.value.mutation, campaignId);
  if (!validation.valid) {
    return errorResponse(422, "mutation_invalid", validation.message);
  }
  const mutation = validation.mutation;
  const createdIds = mutation.type === 'task.create' || mutation.type === 'house.create'
    ? [mutation.payload.taskId]
    : mutation.type === 'house.create-batch' ? mutation.payload.houses.map(house => house.taskId) : [];
  if (createdIds.some(id => id.startsWith('task_auto_') || id.startsWith('task_house_auto_'))) {
    return errorResponse(422, 'auto_street_id_reserved', 'Automatische IDs sind ausschließlich serverseitig reserviert.');
  }
  if (mutation.type === "team.delete" && access.role !== "admin") {
    return errorResponse(403, "team_delete_forbidden", "Nur Admins dürfen Teams löschen.");
  }
  const isCollectionMutation = mutation.type.startsWith("collection.");
  if (access.role === "collection-collector") {
    if (!isCollectionMutation || !access.collectorId) {
      return errorResponse(
        403,
        "collection_scope_forbidden",
        "Collection-Helfer dürfen nur Collection-Mutationen ausführen.",
      );
    }
    const actorId =
      typeof (mutation.payload as Record<string, unknown>).collectorId === "string"
        ? (mutation.payload as Record<string, unknown>).collectorId
        : null;
    if (actorId !== access.collectorId) {
      return errorResponse(
        403,
        "collection_actor_forbidden",
        "Die Mutation gehört nicht zu diesem Collection-Gerät.",
      );
    }
  } else if (isCollectionMutation && access.role !== "admin") {
    return errorResponse(
      403,
      "collection_scope_forbidden",
      "Nur Admins oder Collection-Helfer dürfen Collection ändern.",
    );
  }

  if (
    access.role === "field-group-member" &&
    mutation.type !== "task.set-status" &&
    mutation.type !== "house.set-status"
  ) {
    return errorResponse(
      403,
      "field_group_scope_forbidden",
      "Temporäre Gruppenmitglieder dürfen nur Arbeitsstatus im eigenen Team ändern.",
    );
  }

  const fingerprint = await fingerprintCampaignMutation(mutation);

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

  const persistAttempts=await hasBaseStorage(db)?1:MAX_PERSIST_ATTEMPTS;
  for (let attempt = 0; attempt < persistAttempts; attempt += 1) {
    const current = await loadCampaignSnapshot(db, campaignId, mutationSnapshotOptions(mutation, access));
    if (!current) {
      return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
    }

    if (mutation.type === "collection.admin.force-release-area") {
      const area = current.collection?.areas.find(
        (candidate) => candidate.id === mutation.payload.areaId,
      );
      if (!area || area.runId !== mutation.payload.runId) {
        return errorResponse(
          409,
          "mutation_conflict",
          "Collection Area und Run passen nicht zum aktuellen Serverstand.",
          current.revision,
        );
      }
    }

    let candidate;
    try {
      candidate = applyCampaignMutation(current, mutation);
    } catch (error) {
      if (error instanceof CampaignMutationConflictError) {
        if (error.reason === "street_outside_area") {
          return errorResponse(
            409,
            "street_outside_area",
            "Die Straße muss vollständig innerhalb des Gebiets liegen.",
            current.revision,
          );
        }
        if (error.reason === "auto_prepared_task_delete_forbidden") {
          return errorResponse(
            409,
            "auto_prepared_task_delete_forbidden",
            "Automatisch vorbereitete Tasks werden über ihren Status gesteuert und nicht gelöscht.",
            current.revision,
          );
        }
        if (error.reason === "team_has_areas") {
          return errorResponse(
            409,
            "team_delete_has_areas",
            "Team kann nicht gelöscht werden, solange Gebiete zugeordnet sind.",
            current.revision,
          );
        }
        if (error.reason === "team_missing" || error.reason === "team_changed") {
          return errorResponse(
            409,
            error.reason,
            error.reason === "team_missing" ? "Das Team wurde bereits gelöscht." : "Das Team wurde inzwischen geändert.",
            current.revision,
          );
        }
        return errorResponse(
          409,
          "mutation_conflict",
          `Mutation steht im Konflikt mit dem aktuellen Serverstand (${error.reason}).`,
          current.revision,
        );
      }
      throw error;
    }

    const snapshotValidation = validateCampaignSnapshotWithLegacyHouseTolerance(
      current,
      candidate,
      campaignId,
    );
    if (!snapshotValidation.valid) {
      return errorResponse(422, "mutation_invalid", snapshotValidation.message, current.revision);
    }

    const authorization = authorizeSnapshotWrite(access, current, snapshotValidation.snapshot);
    if (!authorization.allowed) {
      return errorResponse(
        403,
        "write_forbidden",
        "Die Änderung liegt außerhalb deiner Berechtigung.",
        current.revision,
      );
    }

    if (mutation.type === "team.delete") {
      const blocker = await teamDeleteBlocker(db, campaignId, mutation.payload.teamId);
      if (blocker) {
        const messages: Record<string, string> = {
          team_delete_has_areas: "Team kann nicht gelöscht werden, solange Gebiete zugeordnet sind.",
          team_delete_has_field_groups: "Team kann nicht gelöscht werden, weil Einsätze/Touren darauf verweisen.",
          team_delete_has_sessions: "Team kann nicht gelöscht werden, weil Einsatzhistorie vorhanden ist.",
          team_delete_has_history: "Team kann nicht gelöscht werden, weil Einsatzhistorie vorhanden ist.",
          team_delete_has_access_grants: "Team kann nicht gelöscht werden, solange ein aktiver Team-Link existiert.",
          team_delete_schema_unavailable: "Team kann nicht sicher gelöscht werden, weil die Serverdatenbank noch nicht vollständig geprüft werden kann.",
        };
        return errorResponse(409, blocker, messages[blocker], current.revision);
      }
    }

    if (
      mutation.type === "area.update-geometry" &&
      !await hasBaseStorage(db) &&
      await areaHasStartedAutomaticWork(db, campaignId, mutation.payload.areaId)
    ) {
      return errorResponse(
        409,
        "area_has_started_work",
        "Die Area kann nicht mehr geändert werden, weil automatische Arbeit bereits begonnen wurde.",
        current.revision,
      );
    }

    if (mutation.type === 'task.set-status' && current.tasks.find(task => task.id === mutation.payload.taskId)?.network) {
      return errorResponse(409, 'network_intent_required', 'Bitte den vorbereiteten Straßenabschnitt auswählen.', current.revision);
    }

    const eventSchemaAvailable =
      (mutation.type === "task.set-status" || mutation.type === "house.set-status") &&
      (await hasFieldSessionHistorySchema(db));
    const domainEvent = eventSchemaAvailable
      ? await buildMutationDomainEvent(
          db,
          current,
          mutation,
          access,
          parsed.value.fieldGroupId,
        )
      : null;
    const automationExecution =
      eventSchemaAvailable && mutation.type === "house.set-status" && !current.tasks.find(task => task.id === current.houseTasks?.find(house => house.id === mutation.payload.taskId)?.parentStreetTaskId)?.network
        ? await buildAutomationExecution(
            db,
            current,
            candidate,
            mutation,
            domainEvent?.fieldSessionId ?? null,
        )
      : null;
    let syncAfter = snapshotValidation.snapshot;
    if (automationExecution && mutation.type === "house.set-status") {
      // The guarded D1 batch applies this parent completion after the direct
      // House change. Materialize the expected post-batch parent for the feed.
      syncAfter = {
        ...syncAfter,
        tasks: syncAfter.tasks.map((task) =>
          task.id === automationExecution.parentStreetTaskId && task.status === "open"
            ? { ...task, status: "completed", completedAt: mutation.createdAt, updatedAt: mutation.createdAt }
            : task,
        ),
      };
    }
    const chunkAreaDelete=mutation.type==='area.delete'&&await hasBaseStorage(db)&&await db.prepare('SELECT generation FROM street_base_areas WHERE campaign_id=? AND area_id=?').bind(campaignId,mutation.payload.areaId).first();
    const syncChanges = (await hasRxdbSyncSchema(db))
      ? chunkAreaDelete
        ? rxdbChangeFeedEntriesForMutation({...current,tasks:[],houseTasks:[]},{...syncAfter,tasks:[],houseTasks:[]},mutation)
        : rxdbChangeFeedEntriesForMutation(current, syncAfter, mutation)
      : [];

    const automaticPreparation=(mutation.type==='area.create'||mutation.type==='area.update-geometry')&&await hasBaseStorage(db)
      ? {areaId:mutation.payload.areaId,geometryHash:await areaPreparationFingerprint(syncAfter.areas.find(area=>area.id===mutation.payload.areaId)!.geometry),generation:crypto.randomUUID()}:undefined;
    const persisted = await persistCampaignMutation(
      db,
      mutation,
      current.revision,
      fingerprint,
      domainEvent,
      automationExecution,
      syncChanges,
      mutation.type==='house.set-status'||mutation.type==='house.rename'
        ? syncAfter.houseTasks?.find(house=>house.id===mutation.payload.taskId&&house.areaPreparationGeneration)
        : mutation.type==='task.rename'?syncAfter.tasks.find(task=>task.id===mutation.payload.taskId&&task.areaPreparationGeneration):undefined,
      automaticPreparation,
    );
    if (persisted.ok) {
      if(automaticPreparation&&!persisted.alreadyApplied){
        try{await options?.schedule?.(campaignId,true);}catch{
          await db.batch([db.prepare("UPDATE area_task_preparations SET status='failed',last_error_code='area_preparation_runner_unavailable',failed_at=?,updated_at=? WHERE campaign_id=? AND area_id=? AND generation=?").bind(mutation.createdAt,mutation.createdAt,campaignId,automaticPreparation.areaId,automaticPreparation.generation)]);
        }
      }
      if (
        AUTO_AREA_PREPARATION_ENABLED &&
        !persisted.alreadyApplied &&
        (mutation.type === "area.create" || mutation.type === "area.update-geometry")
      ) {
        const preparation = await beginAreaTaskPreparation(
          db,
          campaignId,
          mutation.payload.areaId,
          options,
        );
        if (preparation.outcome === "run") {
          context?.waitUntil(runAreaTaskPreparation(db, preparation.run, options));
        }
      }
      return json({
        mutationId: mutation.id,
        appliedRevision: persisted.revision,
        alreadyApplied: persisted.alreadyApplied,
      });
    }

    if (persisted.reason === "mutation_id_reused") {
      return errorResponse(
        409,
        "mutation_id_reused",
        "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
        persisted.currentRevision,
      );
    }

    if (persisted.reason === "schema_migration_required") {
      return errorResponse(
        503,
        "schema_migration_required",
        "Diese M6-Änderung kann erst nach der vorbereiteten Datenbankmigration gespeichert werden.",
        persisted.currentRevision,
      );
    }

    if (attempt === persistAttempts - 1) {
      return errorResponse(
        409,
        "revision_conflict",
        "Der Campaign-Stand wurde gleichzeitig auf einem anderen Gerät geändert.",
        persisted.currentRevision,
      );
    }
  }

  return errorResponse(500, "internal_error", "Mutation konnte nicht verarbeitet werden.");
}

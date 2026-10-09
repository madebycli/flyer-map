import { applyCampaignMutation, CampaignMutationConflictError } from "../src/domain/mutations.ts";
import type { AccessContext } from "./access.ts";
import { authorizeSnapshotWrite } from "./authorization.ts";
import { loadCampaignSnapshot, type D1DatabaseLike } from "./campaignRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import { getAppliedMutation, persistCampaignMutation, teamDeleteBlocker } from "./mutationRepository.ts";
import { validateCampaignMutation } from "./mutationValidation.ts";
import { requestDatabase } from "./requestDatabase.ts";
import { validateCampaignSnapshot } from "./snapshotValidation.ts";
import { isPickupMutationInput } from "./pickupMutationRuntime.ts";
import { handlePickupMutationRequest } from "./pickupMutationEntry.ts";

const MAX_MUTATION_BYTES = 256_000;
const MAX_PERSIST_ATTEMPTS = 3;

const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, { ...init, headers: { "cache-control": "no-store", ...init.headers } });

function errorResponse(status: number, code: string, message: string, revision?: number | null) {
  return json({ error: { code, message }, ...(revision !== undefined ? { revision } : {}) }, { status });
}

async function readMutationBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BYTES) return { ok: false as const, response: errorResponse(413, "payload_too_large", "Mutation ist zu groß.") };
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_MUTATION_BYTES) return { ok: false as const, response: errorResponse(413, "payload_too_large", "Mutation ist zu groß.") };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false as const, response: errorResponse(400, "invalid_request", "Mutation-Request ist ungültig.") };
    return { ok: true as const, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false as const, response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON.") };
  }
}

const TEAM_DELETE_MESSAGES: Record<string, string> = {
  team_delete_has_areas: "Team kann nicht gelöscht werden, solange Gebiete zugeordnet sind.",
  team_delete_has_field_groups: "Team kann nicht gelöscht werden, weil Einsätze/Touren darauf verweisen.",
  team_delete_has_sessions: "Team kann nicht gelöscht werden, weil Einsatzhistorie vorhanden ist.",
  team_delete_has_history: "Team kann nicht gelöscht werden, weil Einsatzhistorie vorhanden ist.",
  team_delete_has_access_grants: "Team kann nicht gelöscht werden, solange ein aktiver Team-Link existiert.",
  team_delete_schema_unavailable: "Team kann nicht sicher gelöscht werden, weil die Serverdatenbank noch nicht vollständig geprüft werden kann.",
};

/**
 * The one write path of the field map for everything that is not status or notes: Aktion name, Gruppen, Gebiete, the Abholaktion and Sonder-Marker.
 * A mutation is validated, checked against the role, checked against the current state (expected `updatedAt`), then applied in one guarded batch.
 * The same mutation id with the same content is answered, never applied twice.
 */
export async function handleCampaignMutation(request: Request, db: D1DatabaseLike, campaignId: string, access: AccessContext) {
  db = requestDatabase(db);
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Für Mutationen ist nur POST erlaubt.");
  if (access.role === "viewer") return errorResponse(403, "viewer_read_only", "Read-only Viewer dürfen nichts verändern.");

  const parsed = await readMutationBody(request);
  if (!parsed.ok) return parsed.response;

  if (isPickupMutationInput(parsed.value.mutation)) return handlePickupMutationRequest(db, campaignId, access, parsed.value.mutation);

  const validation = validateCampaignMutation(parsed.value.mutation, campaignId);
  if (!validation.valid) return errorResponse(422, "mutation_invalid", validation.message);
  const mutation = validation.mutation;

  if (mutation.type === "team.delete" && access.role !== "admin") return errorResponse(403, "team_delete_forbidden", "Nur Admins dürfen Teams löschen.");
  const isCollectionMutation = mutation.type.startsWith("collection.");
  if (access.role === "collection-collector") {
    if (!isCollectionMutation || !access.collectorId) return errorResponse(403, "collection_scope_forbidden", "Collection-Helfer dürfen nur Collection-Mutationen ausführen.");
    const actorId = typeof (mutation.payload as Record<string, unknown>).collectorId === "string" ? (mutation.payload as Record<string, unknown>).collectorId : null;
    if (actorId !== access.collectorId) return errorResponse(403, "collection_actor_forbidden", "Die Mutation gehört nicht zu diesem Collection-Gerät.");
  } else if (isCollectionMutation && access.role !== "admin") {
    return errorResponse(403, "collection_scope_forbidden", "Nur Admins oder Collection-Helfer dürfen Collection ändern.");
  }

  const fingerprint = await fingerprintCampaignMutation(mutation);
  const existing = await getAppliedMutation(db, campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) return errorResponse(409, "mutation_id_reused", "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.", existing.appliedRevision);
    return json({ mutationId: mutation.id, appliedRevision: existing.appliedRevision, alreadyApplied: true });
  }

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    // Tasks and houses of the old map are not part of what these mutations change: leaving them out keeps every write small.
    const current = await loadCampaignSnapshot(db, campaignId, { includeCollection: isCollectionMutation, includeTasks: false, includeHouses: false });
    if (!current) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");

    if (mutation.type === "collection.admin.force-release-area") {
      const area = current.collection?.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      if (!area || area.runId !== mutation.payload.runId) return errorResponse(409, "mutation_conflict", "Collection Area und Run passen nicht zum aktuellen Serverstand.", current.revision);
    }

    let candidate;
    try {
      candidate = applyCampaignMutation(current, mutation);
    } catch (error) {
      if (!(error instanceof CampaignMutationConflictError)) throw error;
      if (error.reason === "team_has_areas") return errorResponse(409, "team_delete_has_areas", "Team kann nicht gelöscht werden, solange Gebiete zugeordnet sind.", current.revision);
      if (error.reason === "team_missing" || error.reason === "team_changed") {
        return errorResponse(409, error.reason, error.reason === "team_missing" ? "Das Team wurde bereits gelöscht." : "Das Team wurde inzwischen geändert.", current.revision);
      }
      return errorResponse(409, "mutation_conflict", `Mutation steht im Konflikt mit dem aktuellen Serverstand (${error.reason}).`, current.revision);
    }

    const snapshotValidation = validateCampaignSnapshot(candidate, campaignId);
    if (!snapshotValidation.valid) return errorResponse(422, "mutation_invalid", snapshotValidation.message, current.revision);

    if (!authorizeSnapshotWrite(access, current, snapshotValidation.snapshot).allowed) {
      return errorResponse(403, "write_forbidden", "Die Änderung liegt außerhalb deiner Berechtigung.", current.revision);
    }

    if (mutation.type === "team.delete") {
      const blocker = await teamDeleteBlocker(db, campaignId, mutation.payload.teamId);
      if (blocker) return errorResponse(409, blocker, TEAM_DELETE_MESSAGES[blocker], current.revision);
    }

    const persisted = await persistCampaignMutation(db, mutation, current.revision, fingerprint);
    if (persisted.ok) return json({ mutationId: mutation.id, appliedRevision: persisted.revision, alreadyApplied: persisted.alreadyApplied });
    if (persisted.reason === "mutation_id_reused") return errorResponse(409, "mutation_id_reused", "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.", persisted.currentRevision);
    if (persisted.reason === "schema_migration_required") return errorResponse(503, "schema_migration_required", "Diese Änderung kann erst nach der vorbereiteten Datenbankmigration gespeichert werden.", persisted.currentRevision);
    if (attempt === MAX_PERSIST_ATTEMPTS - 1) return errorResponse(409, "revision_conflict", "Der Campaign-Stand wurde gleichzeitig auf einem anderen Gerät geändert.", persisted.currentRevision);
  }
  return errorResponse(500, "internal_error", "Mutation konnte nicht verarbeitet werden.");
}

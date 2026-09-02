import {
  documentForCollection,
  type RxdbCheckpoint,
  type RxdbCollectionName,
  type RxdbDocument,
  type RxdbPullResponse,
  type RxdbPushRow,
} from "../src/data/rxdbSyncProtocol.ts";
import { deriveMutationFromRxdbWrite } from "../src/domain/rxdbMutationAdapter.ts";
import type { AccessContext } from "./access.ts";
import {
  loadCampaignSnapshot,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { handleCampaignMutation } from "./mutationHandler.ts";
import { hasRxdbSyncSchema } from "./rxdbChangeFeed.ts";

const MAX_PULL_BATCH = 250;
const MAX_PUSH_ROWS = 40;
const MAX_PUSH_BYTES = 256_000;

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...init.headers },
  });

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, { status });

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  map_center_lng: number | null;
  map_center_lat: number | null;
  map_zoom: number | null;
  map_bearing: number | null;
  created_at: string;
  updated_at: string;
};
type TeamRow = { id: string; campaign_id: string; name: string; color: string; created_at: string; updated_at: string };
type AreaRow = { id: string; campaign_id: string; team_id: string; name: string; geometry_json: string; created_at: string; updated_at: string };
type TaskRow = {
  id: string; campaign_id: string; area_id: string; label: string; geometry_json: string;
  source_json: string | null; area_preparation_generation: string | null;
  status: "open" | "completed" | "later" | "not-deliverable";
  completed_at: string | null; created_at: string; updated_at: string;
};
type HouseRow = TaskRow & { parent_street_task_id: string | null };

function parseJson(raw: string) {
  return JSON.parse(raw) as unknown;
}

function fieldGroupScope(access: AccessContext) {
  return access.role === "field-group-member" && access.teamId ? access.teamId : null;
}

function fieldGroupScopeIsValid(access: AccessContext) {
  return access.role !== "field-group-member" || Boolean(access.teamId);
}

function campaignDocument(row: CampaignRow): RxdbDocument {
  const hasMapView = row.map_center_lng !== null && row.map_center_lat !== null && row.map_zoom !== null;
  return {
    id: row.id,
    campaignId: row.id,
    name: row.name,
    status: row.status,
    defaultMapView: hasMapView
      ? { center: [row.map_center_lng as number, row.map_center_lat as number], zoom: row.map_zoom as number, bearing: row.map_bearing ?? 0 }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function teamDocument(row: TeamRow): RxdbDocument {
  return { id: row.id, campaignId: row.campaign_id, name: row.name, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at };
}

function areaDocument(row: AreaRow): RxdbDocument {
  return { id: row.id, campaignId: row.campaign_id, teamId: row.team_id, name: row.name, geometry: parseJson(row.geometry_json), createdAt: row.created_at, updatedAt: row.updated_at } as RxdbDocument;
}

function streetDocument(row: TaskRow): RxdbDocument {
  return {
    id: row.id, campaignId: row.campaign_id, areaId: row.area_id, taskType: "street", label: row.label,
    geometry: parseJson(row.geometry_json), ...(row.source_json ? { source: parseJson(row.source_json) } : {}),
    areaPreparationGeneration: row.area_preparation_generation, status: row.status,
    completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  } as RxdbDocument;
}

function houseDocument(row: HouseRow): RxdbDocument {
  return {
    id: row.id, campaignId: row.campaign_id, areaId: row.area_id, taskType: "house", label: row.label,
    geometry: parseJson(row.geometry_json), ...(row.source_json ? { source: parseJson(row.source_json) } : {}),
    areaPreparationGeneration: row.area_preparation_generation, parentStreetTaskId: row.parent_street_task_id,
    status: row.status, completedAt: row.completed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  } as RxdbDocument;
}

async function bootstrapDocuments(
  db: D1DatabaseLike,
  campaignId: string,
  collectionName: RxdbCollectionName,
  access: AccessContext,
): Promise<RxdbDocument[]> {
  const groupTeamId = fieldGroupScope(access);
  try {
    switch (collectionName) {
      case "campaigns": {
        const row = await db.prepare(
          "SELECT id, name, status, map_center_lng, map_center_lat, map_zoom, map_bearing, created_at, updated_at FROM campaigns WHERE id = ?",
        ).bind(campaignId).first<CampaignRow>();
        return row ? [campaignDocument(row)] : [];
      }
      case "teams": {
        const result = groupTeamId
          ? await db.prepare("SELECT id, campaign_id, name, color, created_at, updated_at FROM teams WHERE campaign_id = ? AND id = ? ORDER BY created_at, id").bind(campaignId, groupTeamId).all<TeamRow>()
          : await db.prepare("SELECT id, campaign_id, name, color, created_at, updated_at FROM teams WHERE campaign_id = ? ORDER BY created_at, id").bind(campaignId).all<TeamRow>();
        return result.results.map(teamDocument);
      }
      case "areas": {
        const result = groupTeamId
          ? await db.prepare("SELECT id, campaign_id, team_id, name, geometry_json, created_at, updated_at FROM areas WHERE campaign_id = ? AND team_id = ? ORDER BY created_at, id").bind(campaignId, groupTeamId).all<AreaRow>()
          : await db.prepare("SELECT id, campaign_id, team_id, name, geometry_json, created_at, updated_at FROM areas WHERE campaign_id = ? ORDER BY created_at, id").bind(campaignId).all<AreaRow>();
        return result.results.map(areaDocument);
      }
      case "streetTasks": {
        const sql = "SELECT t.id, t.campaign_id, t.area_id, t.label, t.geometry_json, t.source_json, t.area_preparation_generation, t.status, t.completed_at, t.created_at, t.updated_at FROM tasks t JOIN areas a ON a.id = t.area_id AND a.campaign_id = t.campaign_id WHERE t.campaign_id = ?" + (groupTeamId ? " AND a.team_id = ?" : "") + " ORDER BY t.created_at, t.id";
        const statement = db.prepare(sql);
        const result = groupTeamId ? await statement.bind(campaignId, groupTeamId).all<TaskRow>() : await statement.bind(campaignId).all<TaskRow>();
        return result.results.map(streetDocument);
      }
      case "houseTasks": {
        const sql = "SELECT h.id, h.campaign_id, h.area_id, h.parent_street_task_id, h.label, h.geometry_json, h.source_json, h.area_preparation_generation, h.status, h.completed_at, h.created_at, h.updated_at FROM house_tasks h JOIN areas a ON a.id = h.area_id AND a.campaign_id = h.campaign_id WHERE h.campaign_id = ?" + (groupTeamId ? " AND a.team_id = ?" : "") + " ORDER BY h.created_at, h.id";
        const statement = db.prepare(sql);
        const result = groupTeamId ? await statement.bind(campaignId, groupTeamId).all<HouseRow>() : await statement.bind(campaignId).all<HouseRow>();
        return result.results.map(houseDocument);
      }
    }
  } catch {
    throw new Error("rxdb_bootstrap_schema_unavailable");
  }
}

async function currentCampaignRevision(db: D1DatabaseLike, campaignId: string) {
  const row = await db.prepare("SELECT revision FROM campaigns WHERE id = ?").bind(campaignId).first<{ revision: number }>();
  return typeof row?.revision === "number" && Number.isSafeInteger(row.revision) && row.revision >= 0 ? row.revision : 0;
}

function checkpointFrom(value: unknown): RxdbCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const seq = (value as Record<string, unknown>).seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? { seq } : null;
}

function batchSizeFrom(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.max(1, Math.min(MAX_PULL_BATCH, value))
    : 100;
}

export async function handleRxdbPull(
  db: D1DatabaseLike,
  campaignId: string,
  collectionName: RxdbCollectionName,
  access: AccessContext,
  body: unknown,
): Promise<Response> {
  if (!fieldGroupScopeIsValid(access)) return errorResponse(403, "field_group_scope_forbidden", "Temporäre Gruppenmitglieder benötigen ein kanonisches Team.");
  if (!(await hasRxdbSyncSchema(db))) {
    return errorResponse(503, "rxdb_sync_schema_unavailable", "RxDB-Synchronisation benötigt die vorbereitete Migration 0017.");
  }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const checkpointValue = "checkpoint" in input ? input.checkpoint : undefined;
  const checkpoint = checkpointValue === undefined || checkpointValue === null ? null : checkpointFrom(checkpointValue);
  if (checkpointValue !== undefined && checkpointValue !== null && !checkpoint) {
    return errorResponse(400, "invalid_checkpoint", "RxDB-Checkpoint ist ungültig.");
  }
  const batchSize = batchSizeFrom(input.batchSize);

  if (!checkpoint) {
    const highWater = await db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?",
    ).bind(campaignId).first<{ seq: number }>();
    try {
      const documents = await bootstrapDocuments(db, campaignId, collectionName, access);
      return json({ documents, checkpoint: { seq: highWater?.seq ?? 0 }, campaignRevision: await currentCampaignRevision(db, campaignId) } satisfies RxdbPullResponse);
    } catch {
      return errorResponse(503, "rxdb_bootstrap_unavailable", "RxDB-Bootstrap benötigt die vorbereiteten Task-Schemas.");
    }
  }

  const groupTeamId = fieldGroupScope(access);
  const scopedToTeam = Boolean(groupTeamId && collectionName !== "campaigns");
  const highWaterRow = await db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?").bind(campaignId).first<{ seq: number }>();
  const highWater = typeof highWaterRow?.seq === "number" && Number.isSafeInteger(highWaterRow.seq) ? highWaterRow.seq : checkpoint.seq;
  const sql = "SELECT seq, document_json FROM campaign_sync_changes WHERE campaign_id = ? AND collection_name = ? AND seq > ? AND seq <= ?" + (scopedToTeam ? " AND scope_team_id = ?" : "") + " ORDER BY seq ASC LIMIT ?";
  const statement = db.prepare(sql);
  const result = scopedToTeam
    ? await statement.bind(campaignId, collectionName, checkpoint.seq, highWater, groupTeamId, batchSize).all<{ seq: number; document_json: string }>()
    : await statement.bind(campaignId, collectionName, checkpoint.seq, highWater, batchSize).all<{ seq: number; document_json: string }>();
  try {
    const documents = result.results.map((row) => parseJson(row.document_json) as RxdbDocument);
    // Once the visible page is exhausted, advance over foreign-team rows too;
    // those rows are intentionally filtered and must not cause a hot retry loop.
    const last = result.results.length < batchSize
      ? Math.max(checkpoint.seq, highWater)
      : result.results.at(-1)?.seq ?? checkpoint.seq;
    return json({ documents, checkpoint: { seq: last }, campaignRevision: await currentCampaignRevision(db, campaignId) } satisfies RxdbPullResponse);
  } catch {
    return errorResponse(500, "rxdb_change_feed_invalid", "Der kanonische RxDB-Change-Feed enthält ungültige Daten.");
  }
}

/**
 * A single lightweight Campaign-level high-water check used by the safety
 * timer.  It deliberately does not bootstrap any collection or expose data.
 */
export async function handleRxdbCheckpoint(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
): Promise<Response> {
  if (!fieldGroupScopeIsValid(access)) {
    return errorResponse(403, "field_group_scope_forbidden", "Temporäre Gruppenmitglieder benötigen ein kanonisches Team.");
  }
  if (!(await hasRxdbSyncSchema(db))) {
    return errorResponse(503, "rxdb_sync_schema_unavailable", "RxDB-Synchronisation benötigt die vorbereitete Migration 0017.");
  }
  const row = await db.prepare(
    "SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_sync_changes WHERE campaign_id = ?",
  ).bind(campaignId).first<{ seq: number }>();
  const seq = typeof row?.seq === "number" && Number.isSafeInteger(row.seq) && row.seq >= 0 ? row.seq : 0;
  return json({ checkpoint: { seq }, campaignRevision: await currentCampaignRevision(db, campaignId) });
}

function isPushRow(value: unknown): value is RxdbPushRow {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) &&
    "newDocumentState" in value &&
    (value as { newDocumentState?: unknown }).newDocumentState &&
    typeof (value as { newDocumentState?: unknown }).newDocumentState === "object",
  );
}

function currentDocument(
  snapshot: Awaited<ReturnType<typeof loadCampaignSnapshot>>,
  collectionName: RxdbCollectionName,
  id: string,
  fallback: RxdbDocument,
) {
  if (!snapshot) return { ...fallback, _deleted: true } as RxdbDocument;
  const current = documentForCollection(collectionName, snapshot, id);
  return current ?? ({ ...fallback, _deleted: true } as RxdbDocument);
}

function canReadDocument(access: AccessContext, collectionName: RxdbCollectionName, document: RxdbDocument, snapshot: CampaignSnapshot | null) {
  if (access.role !== "field-group-member" || !access.teamId || !snapshot) return true;
  if (collectionName === "campaigns") return true;
  if (collectionName === "teams") return document.id === access.teamId;
  if (collectionName === "areas") return (document as { teamId: string }).teamId === access.teamId;
  const area = snapshot.areas.find((candidate) => candidate.id === (document as { areaId: string }).areaId);
  return area?.teamId === access.teamId;
}

async function responseErrorCode(response: Response) {
  try {
    const payload = await response.clone().json() as { error?: { code?: string } };
    return payload.error?.code ?? "rxdb_push_rejected";
  } catch {
    return "rxdb_push_rejected";
  }
}

export async function handleRxdbPush(
  db: D1DatabaseLike,
  campaignId: string,
  collectionName: RxdbCollectionName,
  access: AccessContext,
  body: unknown,
): Promise<Response> {
  if (access.role === "viewer") return errorResponse(403, "viewer_read_only", "Read-only Viewer dürfen nichts verändern.");
  if (!fieldGroupScopeIsValid(access)) return errorResponse(403, "field_group_scope_forbidden", "Temporäre Gruppenmitglieder benötigen ein kanonisches Team.");
  if (!(await hasRxdbSyncSchema(db))) {
    return errorResponse(503, "rxdb_sync_schema_unavailable", "RxDB-Synchronisation benötigt die vorbereitete Migration 0017.");
  }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const rows = input?.rows;
  if (!Array.isArray(rows) || rows.length > MAX_PUSH_ROWS || new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_PUSH_BYTES) {
    return errorResponse(400, "invalid_rxdb_push", "RxDB-Push ist ungültig oder zu groß.");
  }

  const conflicts: RxdbDocument[] = [];
  const rejections: Array<{ documentId: string; code: string }> = [];
  for (const row of rows) {
    if (!isPushRow(row)) {
      const candidate = row && typeof row === "object" && !Array.isArray(row)
        ? (row as { newDocumentState?: { id?: unknown } }).newDocumentState
        : undefined;
      rejections.push({ documentId: typeof candidate?.id === "string" ? candidate.id : "unknown", code: "invalid_rxdb_push" });
      continue;
    }
    const next = row.newDocumentState as RxdbDocument;
    if (typeof next.id !== "string" || typeof next.campaignId !== "string" || next.campaignId !== campaignId) {
      return errorResponse(400, "invalid_rxdb_document", "RxDB-Dokument gehört nicht zur angeforderten Campaign.");
    }
    const snapshot = await loadCampaignSnapshot(db, campaignId);
    if (!snapshot) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
    const decision = deriveMutationFromRxdbWrite(collectionName, snapshot, row, new Date().toISOString());
    if (decision.kind === "ack") continue;
    if (decision.kind === "apply") {
      const request = new Request("https://flyer-map.invalid/api/campaigns/" + encodeURIComponent(campaignId) + "/mutations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mutation: decision.mutation, fieldGroupId: access.groupId ?? null }),
      });
      const mutationResponse = await handleCampaignMutation(request, db, campaignId, access);
      if (mutationResponse.ok) continue;
      // Retryable server/schema failures must stay in RxDB's pending state.
      // Only a bounded client/auth/domain rejection is resolved for this row.
      if (mutationResponse.status >= 500) {
        throw new Error(await responseErrorCode(mutationResponse));
      }
      rejections.push({ documentId: next.id, code: await responseErrorCode(mutationResponse) });
    } else {
      rejections.push({ documentId: next.id, code: decision.reason });
    }
    const canonical = await loadCampaignSnapshot(db, campaignId);
    const master = currentDocument(canonical, collectionName, next.id, next);
    conflicts.push(canReadDocument(access, collectionName, master, canonical) ? master : { ...next, _deleted: true });
  }

  return json({ conflicts, rejections });
}

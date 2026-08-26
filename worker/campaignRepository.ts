import type { CampaignSnapshot } from "../src/domain/campaign.ts";

export type D1RunResult = {
  success: boolean;
  meta?: { changes?: number };
  results?: unknown[];
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
};

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  revision: number;
  map_center_lng: number | null;
  map_center_lat: number | null;
  map_zoom: number | null;
  map_bearing: number | null;
  created_at: string;
  updated_at: string;
};

type TeamRow = {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type AreaRow = {
  id: string;
  campaign_id: string;
  team_id: string;
  name: string;
  geometry_json: string;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  campaign_id: string;
  area_id: string;
  task_type: "street";
  label: string;
  geometry_json: string;
  source_json: string | null;
  status: "open" | "completed" | "later" | "not-deliverable";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export class StoredSnapshotError extends Error {}

export async function getCampaignRevision(db: D1DatabaseLike, campaignId: string) {
  const row = await db
    .prepare("SELECT revision FROM campaigns WHERE id = ?")
    .bind(campaignId)
    .first<{ revision: number }>();

  return row?.revision ?? null;
}

export async function campaignExists(db: D1DatabaseLike, campaignId: string) {
  return (await getCampaignRevision(db, campaignId)) !== null;
}

export async function loadCampaignSnapshot(
  db: D1DatabaseLike,
  campaignId: string,
): Promise<CampaignSnapshot | null> {
  const campaign = await db
    .prepare(
      `SELECT id, name, status, revision,
              map_center_lng, map_center_lat, map_zoom, map_bearing,
              created_at, updated_at
       FROM campaigns WHERE id = ?`,
    )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!campaign) return null;

  const [teamResult, areaResult, taskResult] = await Promise.all([
    db
      .prepare(
        "SELECT id, campaign_id, name, color, created_at, updated_at FROM teams WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<TeamRow>(),
    db
      .prepare(
        "SELECT id, campaign_id, team_id, name, geometry_json, created_at, updated_at FROM areas WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<AreaRow>(),
    db
      .prepare(
        "SELECT id, campaign_id, area_id, task_type, label, geometry_json, source_json, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<TaskRow>(),
  ]);

  const hasDefaultMapView =
    campaign.map_center_lng !== null &&
    campaign.map_center_lat !== null &&
    campaign.map_zoom !== null;

  try {
    return {
      schemaVersion: 3,
      revision: campaign.revision,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        defaultMapView: hasDefaultMapView
          ? {
              center: [campaign.map_center_lng as number, campaign.map_center_lat as number],
              zoom: campaign.map_zoom as number,
              bearing: campaign.map_bearing ?? 0,
            }
          : null,
        createdAt: campaign.created_at,
        updatedAt: campaign.updated_at,
      },
      teams: teamResult.results.map((team) => ({
        id: team.id,
        campaignId: team.campaign_id,
        name: team.name,
        color: team.color,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      })),
      areas: areaResult.results.map((area) => ({
        id: area.id,
        campaignId: area.campaign_id,
        teamId: area.team_id,
        name: area.name,
        geometry: JSON.parse(area.geometry_json),
        createdAt: area.created_at,
        updatedAt: area.updated_at,
      })),
      tasks: taskResult.results.map((task) => ({
        id: task.id,
        campaignId: task.campaign_id,
        areaId: task.area_id,
        taskType: task.task_type,
        label: task.label,
        geometry: JSON.parse(task.geometry_json),
        ...(task.source_json ? { source: JSON.parse(task.source_json) } : {}),
        status: task.status,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      })),
    };
  } catch {
    throw new StoredSnapshotError("Stored campaign geometry or Task provenance is not valid JSON.");
  }
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function teamsBulkInsert(db: D1DatabaseLike, snapshot: CampaignSnapshot, writeToken: string) {
  return db
    .prepare(
      `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.name'),
         json_extract(value, '$.color'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`,
    )
    .bind(JSON.stringify(snapshot.teams), snapshot.campaign.id, writeToken);
}

function areasBulkInsert(db: D1DatabaseLike, snapshot: CampaignSnapshot, writeToken: string) {
  return db
    .prepare(
      `INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at)
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.teamId'),
         json_extract(value, '$.name'),
         json_extract(value, '$.geometry'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`,
    )
    .bind(JSON.stringify(snapshot.areas), snapshot.campaign.id, writeToken);
}

function tasksBulkInsert(db: D1DatabaseLike, snapshot: CampaignSnapshot, writeToken: string) {
  return db
    .prepare(
      `INSERT INTO tasks (
         id, campaign_id, area_id, task_type, label, geometry_json, source_json,
         status, completed_at, created_at, updated_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.areaId'),
         json_extract(value, '$.taskType'),
         json_extract(value, '$.label'),
         json_extract(value, '$.geometry'),
         CASE
           WHEN json_type(value, '$.source') IS NULL THEN NULL
           ELSE json_extract(value, '$.source')
         END,
         json_extract(value, '$.status'),
         json_extract(value, '$.completedAt'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`,
    )
    .bind(JSON.stringify(snapshot.tasks), snapshot.campaign.id, writeToken);
}

export type ReplaceSnapshotResult =
  | { ok: true; revision: number }
  | { ok: false; currentRevision: number | null };

export async function replaceCampaignSnapshot(
  db: D1DatabaseLike,
  snapshot: CampaignSnapshot,
  baseRevision: number | null,
): Promise<ReplaceSnapshotResult> {
  const writeToken = crypto.randomUUID();
  const nextRevision = baseRevision === null ? snapshot.revision : baseRevision + 1;
  const mapView = snapshot.campaign.defaultMapView;

  const claim =
    baseRevision === null
      ? db
          .prepare(
            `INSERT OR IGNORE INTO campaigns (
               id, name, status, revision, write_token,
               map_center_lng, map_center_lat, map_zoom, map_bearing,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            snapshot.campaign.id,
            snapshot.campaign.name,
            snapshot.campaign.status,
            nextRevision,
            writeToken,
            mapView?.center[0] ?? null,
            mapView?.center[1] ?? null,
            mapView?.zoom ?? null,
            mapView?.bearing ?? null,
            snapshot.campaign.createdAt,
            snapshot.campaign.updatedAt,
          )
      : db
          .prepare(
            `UPDATE campaigns SET
               name = ?, status = ?, revision = ?, write_token = ?,
               map_center_lng = ?, map_center_lat = ?, map_zoom = ?, map_bearing = ?,
               created_at = ?, updated_at = ?
             WHERE id = ? AND revision = ?`,
          )
          .bind(
            snapshot.campaign.name,
            snapshot.campaign.status,
            nextRevision,
            writeToken,
            mapView?.center[0] ?? null,
            mapView?.center[1] ?? null,
            mapView?.zoom ?? null,
            mapView?.bearing ?? null,
            snapshot.campaign.createdAt,
            snapshot.campaign.updatedAt,
            snapshot.campaign.id,
            baseRevision,
          );

  // Keep snapshot replacement to a constant seven D1 statements. The three child
  // collections are passed as JSON and expanded inside SQLite via json_each().
  const results = await db.batch([
    claim,
    db
      .prepare(`DELETE FROM tasks WHERE campaign_id = ? AND ${guardExistsSql()}`)
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
    db
      .prepare(`DELETE FROM areas WHERE campaign_id = ? AND ${guardExistsSql()}`)
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
    db
      .prepare(`DELETE FROM teams WHERE campaign_id = ? AND ${guardExistsSql()}`)
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
    teamsBulkInsert(db, snapshot, writeToken),
    areasBulkInsert(db, snapshot, writeToken),
    tasksBulkInsert(db, snapshot, writeToken),
  ]);

  const claimChanges = results[0]?.meta?.changes ?? 0;

  if (claimChanges !== 1) {
    return {
      ok: false,
      currentRevision: await getCampaignRevision(db, snapshot.campaign.id),
    };
  }

  return { ok: true, revision: nextRevision };
}

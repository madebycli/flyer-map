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

export async function loadCampaignSnapshot(
  db: D1DatabaseLike,
  campaignId: string,
): Promise<CampaignSnapshot | null> {
  const campaign = await db
    .prepare(
      "SELECT id, name, status, revision, created_at, updated_at FROM campaigns WHERE id = ?",
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
        "SELECT id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<TaskRow>(),
  ]);

  try {
    return {
      schemaVersion: 2,
      revision: campaign.revision,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
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
        status: task.status,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      })),
    } as CampaignSnapshot;
  } catch {
    throw new StoredSnapshotError("Stored campaign geometry is not valid JSON.");
  }
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function guardedInsert(
  db: D1DatabaseLike,
  sql: string,
  values: unknown[],
  campaignId: string,
  writeToken: string,
) {
  return db.prepare(`${sql} WHERE ${guardExistsSql()}`).bind(...values, campaignId, writeToken);
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

  const claim =
    baseRevision === null
      ? db
          .prepare(
            "INSERT OR IGNORE INTO campaigns (id, name, status, revision, write_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            snapshot.campaign.id,
            snapshot.campaign.name,
            snapshot.campaign.status,
            nextRevision,
            writeToken,
            snapshot.campaign.createdAt,
            snapshot.campaign.updatedAt,
          )
      : db
          .prepare(
            "UPDATE campaigns SET name = ?, status = ?, revision = ?, write_token = ?, created_at = ?, updated_at = ? WHERE id = ? AND revision = ?",
          )
          .bind(
            snapshot.campaign.name,
            snapshot.campaign.status,
            nextRevision,
            writeToken,
            snapshot.campaign.createdAt,
            snapshot.campaign.updatedAt,
            snapshot.campaign.id,
            baseRevision,
          );

  const statements: D1PreparedStatement[] = [
    claim,
    db
      .prepare(
        `DELETE FROM tasks WHERE campaign_id = ? AND ${guardExistsSql()}`,
      )
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
    db
      .prepare(
        `DELETE FROM areas WHERE campaign_id = ? AND ${guardExistsSql()}`,
      )
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
    db
      .prepare(
        `DELETE FROM teams WHERE campaign_id = ? AND ${guardExistsSql()}`,
      )
      .bind(snapshot.campaign.id, snapshot.campaign.id, writeToken),
  ];

  for (const team of snapshot.teams) {
    statements.push(
      guardedInsert(
        db,
        "INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?",
        [team.id, team.campaignId, team.name, team.color, team.createdAt, team.updatedAt],
        snapshot.campaign.id,
        writeToken,
      ),
    );
  }

  for (const area of snapshot.areas) {
    statements.push(
      guardedInsert(
        db,
        "INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?",
        [
          area.id,
          area.campaignId,
          area.teamId,
          area.name,
          JSON.stringify(area.geometry),
          area.createdAt,
          area.updatedAt,
        ],
        snapshot.campaign.id,
        writeToken,
      ),
    );
  }

  for (const task of snapshot.tasks) {
    statements.push(
      guardedInsert(
        db,
        "INSERT INTO tasks (id, campaign_id, area_id, task_type, label, geometry_json, status, completed_at, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?",
        [
          task.id,
          task.campaignId,
          task.areaId,
          task.taskType,
          task.label,
          JSON.stringify(task.geometry),
          task.status,
          task.completedAt,
          task.createdAt,
          task.updatedAt,
        ],
        snapshot.campaign.id,
        writeToken,
      ),
    );
  }

  const results = await db.batch(statements);
  const claimChanges = results[0]?.meta?.changes ?? 0;

  if (claimChanges !== 1) {
    return {
      ok: false,
      currentRevision: await getCampaignRevision(db, snapshot.campaign.id),
    };
  }

  return { ok: true, revision: nextRevision };
}

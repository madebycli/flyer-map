import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  getCampaignRevision,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "./campaignRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";

export type AppliedMutation = {
  mutationType: CampaignMutation["type"];
  mutationFingerprint: string;
  appliedRevision: number;
};

export type MutationPersistenceResult =
  | { ok: true; revision: number; alreadyApplied: boolean }
  | {
      ok: false;
      currentRevision: number | null;
      reason: "revision_conflict" | "mutation_id_reused";
    };

export async function getAppliedMutation(
  db: D1DatabaseLike,
  campaignId: string,
  mutationId: string,
): Promise<AppliedMutation | null> {
  const row = await db
    .prepare(
      `SELECT mutation_type, mutation_fingerprint, applied_revision
       FROM campaign_mutations
       WHERE campaign_id = ? AND mutation_id = ?`,
    )
    .bind(campaignId, mutationId)
    .first<{
      mutation_type: CampaignMutation["type"];
      mutation_fingerprint: string;
      applied_revision: number;
    }>();

  return row
    ? {
        mutationType: row.mutation_type,
        mutationFingerprint: row.mutation_fingerprint,
        appliedRevision: row.applied_revision,
      }
    : null;
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function mutationStatement(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  writeToken: string,
): D1PreparedStatement {
  const guard = guardExistsSql();

  switch (mutation.type) {
    case "campaign.rename":
      return db
        .prepare("UPDATE campaigns SET name = ? WHERE id = ? AND write_token = ?")
        .bind(mutation.payload.name, mutation.campaignId, writeToken);
    case "campaign.set-default-map-view": {
      const view = mutation.payload.defaultMapView;
      return db
        .prepare(
          `UPDATE campaigns SET
             map_center_lng = ?, map_center_lat = ?, map_zoom = ?, map_bearing = ?
           WHERE id = ? AND write_token = ?`,
        )
        .bind(
          view?.center[0] ?? null,
          view?.center[1] ?? null,
          view?.zoom ?? null,
          view?.bearing ?? null,
          mutation.campaignId,
          writeToken,
        );
    }
    case "team.create":
      return db
        .prepare(
          `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.teamId,
          mutation.campaignId,
          mutation.payload.name,
          mutation.payload.color,
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "team.update":
      return db
        .prepare(
          `UPDATE teams SET
             name = COALESCE(?, name), color = COALESCE(?, color), updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.name ?? null,
          mutation.payload.color ?? null,
          mutation.createdAt,
          mutation.payload.teamId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.create":
      return db
        .prepare(
          `INSERT INTO areas (
             id, campaign_id, team_id, name, geometry_json, created_at, updated_at
           ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.payload.teamId,
          mutation.payload.name,
          JSON.stringify(mutation.payload.geometry),
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "area.rename":
      return db
        .prepare(
          `UPDATE areas SET name = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.name,
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.set-team":
      return db
        .prepare(
          `UPDATE areas SET team_id = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.teamId,
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.update-geometry":
      return db
        .prepare(
          `UPDATE areas SET geometry_json = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          JSON.stringify(mutation.payload.geometry),
          mutation.createdAt,
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "area.delete":
      return db
        .prepare(`DELETE FROM areas WHERE id = ? AND campaign_id = ? AND ${guard}`)
        .bind(
          mutation.payload.areaId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "task.create":
      return db
        .prepare(
          `INSERT INTO tasks (
             id, campaign_id, area_id, task_type, label, geometry_json, source_json,
             status, completed_at, created_at, updated_at
           ) SELECT ?, ?, ?, 'street', ?, ?, ?, 'open', NULL, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.payload.areaId,
          mutation.payload.label,
          JSON.stringify(mutation.payload.geometry),
          mutation.payload.source ? JSON.stringify(mutation.payload.source) : null,
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "task.rename":
      return db
        .prepare(
          `UPDATE tasks SET label = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.label,
          mutation.createdAt,
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "task.set-status":
      return db
        .prepare(
          `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ?
           WHERE id = ? AND campaign_id = ? AND ${guard}`,
        )
        .bind(
          mutation.payload.status,
          mutation.payload.completedAt,
          mutation.createdAt,
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    case "task.delete":
      return db
        .prepare(`DELETE FROM tasks WHERE id = ? AND campaign_id = ? AND ${guard}`)
        .bind(
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
  }
}

export async function persistCampaignMutation(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  fromRevision: number,
  fingerprintOverride?: string,
): Promise<MutationPersistenceResult> {
  const fingerprint = fingerprintOverride ?? (await fingerprintCampaignMutation(mutation));
  const existing = await getAppliedMutation(db, mutation.campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) {
      return {
        ok: false,
        currentRevision: existing.appliedRevision,
        reason: "mutation_id_reused",
      };
    }
    return { ok: true, revision: existing.appliedRevision, alreadyApplied: true };
  }

  const writeToken = crypto.randomUUID();
  const nextRevision = fromRevision + 1;
  const claim = db
    .prepare(
      `UPDATE campaigns SET revision = ?, write_token = ?, updated_at = ?
       WHERE id = ? AND revision = ?`,
    )
    .bind(nextRevision, writeToken, mutation.createdAt, mutation.campaignId, fromRevision);

  const ledger = db
    .prepare(
      `INSERT INTO campaign_mutations (
         campaign_id, mutation_id, mutation_type, mutation_fingerprint,
         requested_base_revision, applied_from_revision, applied_revision, client_created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guardExistsSql()}`,
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

  const results = await db.batch([
    claim,
    mutationStatement(db, mutation, writeToken),
    ledger,
  ]);

  if ((results[0]?.meta?.changes ?? 0) === 1) {
    return { ok: true, revision: nextRevision, alreadyApplied: false };
  }

  const appliedAfterRace = await getAppliedMutation(db, mutation.campaignId, mutation.id);
  if (appliedAfterRace) {
    if (appliedAfterRace.mutationFingerprint !== fingerprint) {
      return {
        ok: false,
        currentRevision: appliedAfterRace.appliedRevision,
        reason: "mutation_id_reused",
      };
    }
    return { ok: true, revision: appliedAfterRace.appliedRevision, alreadyApplied: true };
  }

  return {
    ok: false,
    currentRevision: await getCampaignRevision(db, mutation.campaignId),
    reason: "revision_conflict",
  };
}

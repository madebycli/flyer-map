import type { CollectionMutation } from "../src/domain/mutations.ts";
import type { D1DatabaseLike, D1PreparedStatement } from "./campaignRepository.ts";

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function historyStatements(
  db: D1DatabaseLike,
  mutation: CollectionMutation,
  writeToken: string,
  action: "claim" | "release" | "force-release" | "archive",
  areaIds: string[],
  collectorId: string | null,
) {
  if (areaIds.length === 0) return [];
  const guard = guardExistsSql();
  const entries = areaIds.map((areaId) => ({ id: "collection_claim_" + crypto.randomUUID(), areaId }));
  return [
    db.prepare(
      `INSERT INTO collection_area_claims
          (id, campaign_id, area_id, run_id, collector_id, action, occurred_at)
        SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.areaId'),
               ?, ?, ?, ? FROM json_each(?) WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
    ).bind(
      mutation.campaignId,
      "runId" in mutation.payload ? mutation.payload.runId : null,
      collectorId, action, mutation.createdAt, JSON.stringify(entries),
      mutation.campaignId, writeToken,
    ),
  ];
}

function recomputeRunAreas(db: D1DatabaseLike, mutation: CollectionMutation, writeToken: string) {
  const runId = "runId" in mutation.payload ? mutation.payload.runId : null;
  if (!runId) return [];
  const guard = guardExistsSql();
  return [
    db.prepare(
      `UPDATE collection_runs
          SET area_ids_json = COALESCE(
            (SELECT json_group_array(id) FROM collection_areas
              WHERE run_id = ? AND campaign_id = ? ORDER BY created_at, id), '[]'),
              updated_at = ?
        WHERE id = ? AND campaign_id = ? AND @@GUARD@@`.replace("@@GUARD@@", guard),
    ).bind(
      runId, mutation.campaignId, mutation.createdAt, runId, mutation.campaignId,
      mutation.campaignId, writeToken,
    ),
  ];
}

export function collectionMutationStatements(
  db: D1DatabaseLike,
  mutation: CollectionMutation,
  writeToken: string,
): D1PreparedStatement[] {
  const guard = guardExistsSql();
  switch (mutation.type) {
    case "collection.main-area.create":
      return [db.prepare(
        `INSERT INTO collection_main_areas
            (id, campaign_id, name, geometry_json, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ? WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.payload.mainAreaId, mutation.campaignId, mutation.payload.name,
        JSON.stringify(mutation.payload.geometry), mutation.createdAt, mutation.createdAt,
        mutation.campaignId, writeToken,
      )];
    case "collection.main-area.update":
      return [db.prepare(
        `UPDATE collection_main_areas SET name = ?, geometry_json = ?, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND updated_at = ? AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.payload.name, JSON.stringify(mutation.payload.geometry), mutation.createdAt,
        mutation.payload.mainAreaId, mutation.campaignId, mutation.payload.expectedUpdatedAt,
        mutation.campaignId, writeToken,
      )];
    case "collection.area.create":
      return [db.prepare(
        `INSERT INTO collection_areas
            (id, campaign_id, main_area_id, name, geometry_json, color, status,
             run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, NULL, ?, ?
          WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.payload.areaId, mutation.campaignId, mutation.payload.mainAreaId,
        mutation.payload.name, JSON.stringify(mutation.payload.geometry), mutation.payload.color,
        mutation.createdAt, mutation.createdAt, mutation.campaignId, writeToken,
      )];
    case "collection.area.update":
      return [db.prepare(
        `UPDATE collection_areas SET name = ?, geometry_json = ?, color = ?, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND updated_at = ? AND status <> 'archived' AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.payload.name, JSON.stringify(mutation.payload.geometry), mutation.payload.color,
        mutation.createdAt, mutation.payload.areaId, mutation.campaignId,
        mutation.payload.expectedUpdatedAt, mutation.campaignId, writeToken,
      )];
    case "collection.area.archive":
      return [
        db.prepare(
          `UPDATE collection_areas SET status = 'archived', completed_at = NULL, updated_at = ?
            WHERE id = ? AND campaign_id = ? AND status = 'open' AND run_id IS NULL AND @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(mutation.createdAt, mutation.payload.areaId, mutation.campaignId, mutation.campaignId, writeToken),
        ...historyStatements(db, mutation, writeToken, "archive", [mutation.payload.areaId], null),
      ];
    case "collection.run.start":
      return [
        db.prepare(
          `INSERT INTO collection_runs
              (id, campaign_id, main_area_id, status, started_at, ended_at,
               created_by_collector_id, area_ids_json, created_at, updated_at)
            SELECT ?, ?, ?, 'active', ?, NULL, ?, '[]', ?, ? WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(
          mutation.payload.runId, mutation.campaignId, mutation.payload.mainAreaId,
          mutation.createdAt, mutation.payload.collectorId, mutation.createdAt, mutation.createdAt,
          mutation.campaignId, writeToken,
        ),
        db.prepare(
          `INSERT INTO collection_run_members
              (id, run_id, campaign_id, collector_id, label, joined_at, left_at)
            SELECT ?, ?, ?, ?, ?, ?, NULL WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(
          mutation.payload.memberId, mutation.payload.runId, mutation.campaignId,
          mutation.payload.collectorId, mutation.payload.label, mutation.createdAt,
          mutation.campaignId, writeToken,
        ),
      ];
    case "collection.run.claim-areas":
      return [
        db.prepare(
          `UPDATE collection_areas
            SET status = 'claimed', run_id = ?, claimed_by_collector_id = ?,
                claimed_by_label = ?, completed_at = NULL, updated_at = ?
            WHERE campaign_id = ? AND status = 'open' AND run_id IS NULL
              AND id IN (SELECT value FROM json_each(?)) AND @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(
          mutation.payload.runId, mutation.payload.collectorId, mutation.payload.collectorLabel,
          mutation.createdAt, mutation.campaignId, JSON.stringify(mutation.payload.areaIds),
          mutation.campaignId, writeToken,
        ),
        ...recomputeRunAreas(db, mutation, writeToken),
        ...historyStatements(db, mutation, writeToken, "claim", mutation.payload.areaIds, mutation.payload.collectorId),
      ];
    case "collection.run.start-area":
      return [db.prepare(
        `UPDATE collection_areas SET status = 'in-progress', updated_at = ?
          WHERE id = ? AND campaign_id = ? AND run_id = ? AND status = 'claimed' AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.createdAt, mutation.payload.areaId, mutation.campaignId, mutation.payload.runId,
        mutation.campaignId, writeToken,
      )];
    case "collection.run.join":
      return [db.prepare(
        `INSERT INTO collection_run_members
            (id, run_id, campaign_id, collector_id, label, joined_at, left_at)
          SELECT ?, ?, ?, ?, ?, ?, NULL WHERE @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.payload.memberId, mutation.payload.runId, mutation.campaignId,
        mutation.payload.collectorId, mutation.payload.label, mutation.createdAt,
        mutation.campaignId, writeToken,
      )];
    case "collection.run.leave":
      return [db.prepare(
        `UPDATE collection_run_members SET left_at = ?
          WHERE run_id = ? AND campaign_id = ? AND collector_id = ?
            AND left_at IS NULL AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.createdAt, mutation.payload.runId, mutation.campaignId, mutation.payload.collectorId,
        mutation.campaignId, writeToken,
      )];
    case "collection.run.release-area":
    case "collection.admin.force-release-area": {
      const admin = mutation.type === "collection.admin.force-release-area";
      const predicate = admin ? "" : " AND claimed_by_collector_id = ?";
      const sql = `UPDATE collection_areas
          SET status = 'open', run_id = NULL, claimed_by_collector_id = NULL,
              claimed_by_label = NULL, completed_at = NULL, updated_at = ?
        WHERE id = ? AND campaign_id = ? AND status IN ('claimed', 'in-progress')
          AND run_id IS NOT NULL__PREDICATE__ AND @@GUARD@@`
        .replace("__PREDICATE__", predicate)
        .replace("@@GUARD@@", guard);
      const binds = admin
        ? [mutation.createdAt, mutation.payload.areaId, mutation.campaignId, mutation.campaignId, writeToken]
        : [mutation.createdAt, mutation.payload.areaId, mutation.campaignId, mutation.payload.collectorId, mutation.campaignId, writeToken];
      return [
        db.prepare(sql).bind(...binds),
        ...recomputeRunAreas(db, mutation, writeToken),
        ...historyStatements(
          db, mutation, writeToken, admin ? "force-release" : "release",
          [mutation.payload.areaId], admin ? mutation.payload.adminId : mutation.payload.collectorId,
        ),
      ];
    }
    case "collection.run.complete-area":
      return [db.prepare(
        `UPDATE collection_areas SET status = 'completed', completed_at = ?, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND run_id = ? AND status IN ('claimed', 'in-progress')
            AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.createdAt, mutation.createdAt, mutation.payload.areaId, mutation.campaignId,
        mutation.payload.runId, mutation.campaignId, writeToken,
      )];
    case "collection.run.close":
      return [db.prepare(
        `UPDATE collection_runs SET status = 'closed', ended_at = ?, updated_at = ?
          WHERE id = ? AND campaign_id = ? AND status = 'active'
            AND NOT EXISTS (
              SELECT 1 FROM collection_areas
               WHERE run_id = ? AND campaign_id = ? AND status IN ('claimed', 'in-progress')
            ) AND @@GUARD@@`.replace("@@GUARD@@", guard),
      ).bind(
        mutation.createdAt, mutation.createdAt, mutation.payload.runId, mutation.campaignId,
        mutation.payload.runId, mutation.campaignId, mutation.campaignId, writeToken,
      )];
    case "collection.run.cancel":
      return [
        db.prepare(
          `UPDATE collection_runs SET status = 'cancelled', ended_at = ?, updated_at = ?
            WHERE id = ? AND campaign_id = ? AND status = 'active' AND @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(
          mutation.createdAt, mutation.createdAt, mutation.payload.runId, mutation.campaignId,
          mutation.campaignId, writeToken,
        ),
        db.prepare(
          `UPDATE collection_areas
              SET status = 'open', run_id = NULL, claimed_by_collector_id = NULL,
                  claimed_by_label = NULL, completed_at = NULL, updated_at = ?
            WHERE campaign_id = ? AND run_id = ? AND status IN ('claimed', 'in-progress')
              AND @@GUARD@@`.replace("@@GUARD@@", guard),
        ).bind(
          mutation.createdAt, mutation.campaignId, mutation.payload.runId,
          mutation.campaignId, writeToken,
        ),
      ];
  }
}

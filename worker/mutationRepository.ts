import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  getCampaignRevision,
  hasHouseTasksTable,
  hasCollectionSchema,
  hasTaskSourceProvenanceColumn,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from "./campaignRepository.ts";
import type { MutationDomainEvent } from "./mutationEvents.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import type { AutomationExecution } from "./automationRuntime.ts";
import { collectionMutationStatements } from "./collectionMutationRepository.ts";

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
      reason: "revision_conflict" | "mutation_id_reused" | "schema_migration_required";
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
  hasTaskSource: boolean,
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
      return hasTaskSource
        ? db
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
            )
        : db
            .prepare(
              `INSERT INTO tasks (
                 id, campaign_id, area_id, task_type, label, geometry_json,
                 status, completed_at, created_at, updated_at
               ) SELECT ?, ?, ?, 'street', ?, ?, 'open', NULL, ?, ? WHERE ${guard}`,
            )
            .bind(
              mutation.payload.taskId,
              mutation.campaignId,
              mutation.payload.areaId,
              mutation.payload.label,
              JSON.stringify(mutation.payload.geometry),
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
    case "house.create":
      return db
        .prepare(
          `INSERT INTO house_tasks (
             id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
             status, completed_at, created_at, updated_at
           ) SELECT ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ? WHERE ${guard}`,
        )
        .bind(
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.payload.areaId,
          mutation.payload.parentStreetTaskId,
          mutation.payload.label,
          JSON.stringify(mutation.payload.geometry),
          mutation.payload.source ? JSON.stringify(mutation.payload.source) : null,
          mutation.createdAt,
          mutation.createdAt,
          mutation.campaignId,
          writeToken,
        );
    case "house.create-batch":
      return db
        .prepare(
          `INSERT INTO house_tasks (
             id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
             status, completed_at, created_at, updated_at
           )
           SELECT
             json_extract(value, '$.taskId'),
             ?,
             json_extract(value, '$.areaId'),
             json_extract(value, '$.parentStreetTaskId'),
             json_extract(value, '$.label'),
             json_extract(value, '$.geometry'),
             CASE
               WHEN json_type(value, '$.source') IS NULL THEN NULL
               ELSE json_extract(value, '$.source')
             END,
             'open', NULL, ?, ?
           FROM json_each(?)
           WHERE ${guard}`,
        )
        .bind(
          mutation.campaignId,
          mutation.createdAt,
          mutation.createdAt,
          JSON.stringify(mutation.payload.houses),
          mutation.campaignId,
          writeToken,
        );
    case "house.rename":
      return db
        .prepare(
          `UPDATE house_tasks SET label = ?, updated_at = ?
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
    case "house.set-status":
      return db
        .prepare(
          `UPDATE house_tasks SET status = ?, completed_at = ?, updated_at = ?
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
    case "house.delete":
      return db
        .prepare(`DELETE FROM house_tasks WHERE id = ? AND campaign_id = ? AND ${guard}`)
        .bind(
          mutation.payload.taskId,
          mutation.campaignId,
          mutation.campaignId,
          writeToken,
        );
    default:
      throw new Error("collection_mutation_statement_not_supported_here");
  }
}

function domainEventStatement(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  writeToken: string,
  event: MutationDomainEvent,
): D1PreparedStatement {
  const payloadJson = JSON.stringify({
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
  });
  const eventId = "domain_event_mutation_" + mutation.id;
  const dedupeKey = "campaign-mutation:" + mutation.id + ":task-status";

  return db
    .prepare(
      `INSERT OR IGNORE INTO domain_events (
         id, campaign_id, team_id, field_session_id, entity_type, entity_id,
         event_type, occurred_at, actor_kind, actor_ref, payload_version,
         payload_json, dedupe_key, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?
       WHERE ${guardExistsSql()}`,
    )
    .bind(
      eventId,
      mutation.campaignId,
      event.teamId,
      event.fieldSessionId,
      event.entityType,
      event.entityId,
      event.eventType,
      event.occurredAt,
      event.actorKind,
      event.actorRef,
      payloadJson,
      dedupeKey,
      new Date().toISOString(),
      mutation.campaignId,
      writeToken,
    );
}

const AUTOMATION_COMPLETION_PREDICATE = `
    EXISTS (
      SELECT 1
      FROM automation_rules ar
      WHERE ar.campaign_id = parent_task.campaign_id
        AND ar.rule_type = ?
        AND ar.enabled = 1
    )
    AND EXISTS (
      SELECT 1
      FROM house_tasks trigger_house
      WHERE trigger_house.id = ?
        AND trigger_house.campaign_id = parent_task.campaign_id
        AND trigger_house.parent_street_task_id = parent_task.id
        AND trigger_house.area_id = parent_task.area_id
        AND trigger_house.status = 'completed'
        AND trigger_house.updated_at = ?
    )
    AND EXISTS (
      SELECT 1
      FROM house_tasks child_house
      WHERE child_house.campaign_id = parent_task.campaign_id
        AND child_house.parent_street_task_id = parent_task.id
        AND child_house.area_id = parent_task.area_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM house_tasks incomplete_house
      WHERE incomplete_house.campaign_id = parent_task.campaign_id
        AND incomplete_house.parent_street_task_id = parent_task.id
        AND incomplete_house.area_id = parent_task.area_id
        AND incomplete_house.status <> 'completed'
    )`;

function automationParentStatement(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  writeToken: string,
  execution: AutomationExecution,
) {
  return db
    .prepare(
      `UPDATE tasks AS parent_task
       SET status = 'completed', completed_at = ?, updated_at = ?
       WHERE parent_task.id = ?
         AND parent_task.campaign_id = ?
         AND parent_task.status = 'open'
         AND ` +
        AUTOMATION_COMPLETION_PREDICATE +
        `
         AND ${guardExistsSql()}`,
    )
    .bind(
      mutation.createdAt,
      mutation.createdAt,
      execution.parentStreetTaskId,
      mutation.campaignId,
      execution.ruleType,
      execution.triggerHouseTaskId,
      mutation.createdAt,
      mutation.campaignId,
      writeToken,
    );
}

function automationParentEventStatement(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  writeToken: string,
  execution: AutomationExecution,
) {
  const eventId = "domain_event_automation_task_" + mutation.id;
  const dedupeKey = "campaign-mutation:" + mutation.id + ":automation-parent-task-status";
  const payloadJson = JSON.stringify({ previousStatus: "open", newStatus: "completed" });
  return db
    .prepare(
      `INSERT OR IGNORE INTO domain_events (
         id, campaign_id, team_id, field_session_id, entity_type, entity_id,
         event_type, occurred_at, actor_kind, actor_ref, payload_version,
         payload_json, dedupe_key, created_at
       )
       SELECT ?, ?, ?, ?, 'street-task', ?, 'task.status.changed', ?,
              'system', NULL, 1, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM tasks AS parent_task
         WHERE parent_task.id = ?
           AND parent_task.campaign_id = ?
           AND parent_task.status = 'completed'
           AND parent_task.completed_at = ?
           AND parent_task.updated_at = ?
           AND ` +
        AUTOMATION_COMPLETION_PREDICATE +
        `
           AND ${guardExistsSql()}
       )`,
    )
    .bind(
      eventId,
      mutation.campaignId,
      execution.parentTeamId,
      execution.fieldSessionId,
      execution.parentStreetTaskId,
      mutation.createdAt,
      payloadJson,
      dedupeKey,
      new Date().toISOString(),
      execution.parentStreetTaskId,
      mutation.campaignId,
      mutation.createdAt,
      mutation.createdAt,
      execution.ruleType,
      execution.triggerHouseTaskId,
      mutation.createdAt,
      mutation.campaignId,
      writeToken,
    );
}

function automationExecutedEventStatement(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  writeToken: string,
  execution: AutomationExecution,
) {
  const eventId = "domain_event_automation_executed_" + mutation.id;
  const dedupeKey = "campaign-mutation:" + mutation.id + ":automation-executed";
  const payloadJson = JSON.stringify({
    ruleType: execution.ruleType,
    effectType: execution.effectType,
    triggerEntityId: execution.triggerHouseTaskId,
  });
  return db
    .prepare(
      `INSERT OR IGNORE INTO domain_events (
         id, campaign_id, team_id, field_session_id, entity_type, entity_id,
         event_type, occurred_at, actor_kind, actor_ref, payload_version,
         payload_json, dedupe_key, created_at
       )
       SELECT ?, ?, ?, ?, 'street-task', ?, 'automation.executed', ?,
              'system', NULL, 1, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM tasks AS parent_task
         WHERE parent_task.id = ?
           AND parent_task.campaign_id = ?
           AND parent_task.status = 'completed'
           AND parent_task.completed_at = ?
           AND parent_task.updated_at = ?
           AND ` +
        AUTOMATION_COMPLETION_PREDICATE +
        `
           AND ${guardExistsSql()}
       )`,
    )
    .bind(
      eventId,
      mutation.campaignId,
      execution.parentTeamId,
      execution.fieldSessionId,
      execution.parentStreetTaskId,
      mutation.createdAt,
      payloadJson,
      dedupeKey,
      new Date().toISOString(),
      execution.parentStreetTaskId,
      mutation.campaignId,
      mutation.createdAt,
      mutation.createdAt,
      execution.ruleType,
      execution.triggerHouseTaskId,
      mutation.createdAt,
      mutation.campaignId,
      writeToken,
    );
}

export async function persistCampaignMutation(
  db: D1DatabaseLike,
  mutation: CampaignMutation,
  fromRevision: number,
  fingerprintOverride?: string,
  domainEvent: MutationDomainEvent | null = null,
  automationExecution: AutomationExecution | null = null,
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

  const collectionMutation = mutation.type.startsWith("collection.");
  if (collectionMutation && !(await hasCollectionSchema(db))) {
    return {
      ok: false,
      currentRevision: fromRevision,
      reason: "schema_migration_required",
    };
  }

  const houseMutation = mutation.type.startsWith("house.");
  if (houseMutation && !(await hasHouseTasksTable(db))) {
    return {
      ok: false,
      currentRevision: fromRevision,
      reason: "schema_migration_required",
    };
  }

  const hasTaskSource =
    mutation.type === "task.create" ? await hasTaskSourceProvenanceColumn(db) : true;
  if (mutation.type === "task.create" && mutation.payload.source && !hasTaskSource) {
    return {
      ok: false,
      currentRevision: fromRevision,
      reason: "schema_migration_required",
    };
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

  const domainStatements = collectionMutation
    ? collectionMutationStatements(db, mutation as import("../src/domain/mutations.ts").CollectionMutation, writeToken)
    : [mutationStatement(db, mutation, writeToken, hasTaskSource)];
  const statements = [
    claim,
    ...domainStatements,
    ledger,
  ];
  if (domainEvent) {
    statements.push(domainEventStatement(db, mutation, writeToken, domainEvent));
  }
  if (automationExecution) {
    statements.push(
      automationParentStatement(db, mutation, writeToken, automationExecution),
      automationParentEventStatement(db, mutation, writeToken, automationExecution),
      automationExecutedEventStatement(db, mutation, writeToken, automationExecution),
    );
  }

  const results = await db.batch(statements);

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

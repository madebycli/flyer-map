import type { CampaignSnapshot, TaskStatus } from "../src/domain/campaign.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import type { AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

export type MutationDomainEvent = {
  teamId: string;
  fieldSessionId: string | null;
  entityType: "street-task" | "house-task";
  entityId: string;
  eventType: "task.status.changed";
  occurredAt: string;
  actorKind: "campaign-grant" | "temporary-member";
  actorRef: string | null;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
};

type SessionCandidateRow = {
  field_session_id: string;
};

type StatusTarget = {
  teamId: string;
  entityType: "street-task" | "house-task";
  entityId: string;
  previousStatus: TaskStatus;
  newStatus: TaskStatus;
};

const FIELD_GROUP_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

function statusTarget(
  snapshot: CampaignSnapshot,
  mutation: CampaignMutation,
): StatusTarget | null {
  if (mutation.type === "task.set-status") {
    const task = snapshot.tasks.find((candidate) => candidate.id === mutation.payload.taskId);
    const area = task
      ? snapshot.areas.find((candidate) => candidate.id === task.areaId)
      : null;
    if (!task || !area) return null;
    return {
      teamId: area.teamId,
      entityType: "street-task",
      entityId: task.id,
      previousStatus: task.status,
      newStatus: mutation.payload.status,
    };
  }

  if (mutation.type === "house.set-status") {
    const task = (snapshot.houseTasks ?? []).find(
      (candidate) => candidate.id === mutation.payload.taskId,
    );
    const area = task
      ? snapshot.areas.find((candidate) => candidate.id === task.areaId)
      : null;
    if (!task || !area) return null;
    return {
      teamId: area.teamId,
      entityType: "house-task",
      entityId: task.id,
      previousStatus: task.status,
      newStatus: mutation.payload.status,
    };
  }

  return null;
}

function normalizedRequestedGroupId(value: unknown) {
  return typeof value === "string" && FIELD_GROUP_ID_PATTERN.test(value) ? value : null;
}

async function temporaryFieldSessionId(
  db: D1DatabaseLike,
  access: AccessContext,
  teamId: string,
  occurredAt: string,
  requestedFieldGroupId: string | null,
) {
  if (!access.groupId || !access.membershipId) return null;
  if (requestedFieldGroupId && requestedFieldGroupId !== access.groupId) return null;

  const result = await db
    .prepare(
      `SELECT s.id AS field_session_id
       FROM field_sessions s
       JOIN field_group_memberships m
         ON m.group_id = s.field_group_id AND m.campaign_id = s.campaign_id
       WHERE s.campaign_id = ?
         AND s.team_id = ?
         AND s.field_group_id = ?
         AND m.id = ?
         AND m.joined_at <= ?
         AND m.expires_at >= ?
         AND (m.left_at IS NULL OR m.left_at >= ?)
         AND (m.removed_at IS NULL OR m.removed_at >= ?)
         AND s.started_at <= ?
         AND (s.ended_at IS NULL OR s.ended_at >= ?)
       LIMIT 1`,
    )
    .bind(
      access.campaignId,
      teamId,
      access.groupId,
      access.membershipId,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
    )
    .all<SessionCandidateRow>();

  return result.results[0]?.field_session_id ?? null;
}

async function persistentFieldSessionId(
  db: D1DatabaseLike,
  access: AccessContext,
  teamId: string,
  occurredAt: string,
  requestedFieldGroupId: string | null,
) {
  const result = await db
    .prepare(
      `SELECT s.id AS field_session_id
       FROM field_sessions s
       JOIN field_group_memberships m
         ON m.group_id = s.field_group_id AND m.campaign_id = s.campaign_id
       WHERE s.campaign_id = ?
         AND s.team_id = ?
         AND m.campaign_grant_id = ?
         AND m.joined_at <= ?
         AND m.expires_at >= ?
         AND (m.left_at IS NULL OR m.left_at >= ?)
         AND (m.removed_at IS NULL OR m.removed_at >= ?)
         AND s.started_at <= ?
         AND (s.ended_at IS NULL OR s.ended_at >= ?)
         AND (? IS NULL OR s.field_group_id = ?)
       ORDER BY s.started_at DESC, s.id DESC
       LIMIT 2`,
    )
    .bind(
      access.campaignId,
      teamId,
      access.grantId,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
      occurredAt,
      requestedFieldGroupId,
      requestedFieldGroupId,
    )
    .all<SessionCandidateRow>();

  return result.results.length === 1 ? result.results[0].field_session_id : null;
}

export async function buildMutationDomainEvent(
  db: D1DatabaseLike,
  snapshot: CampaignSnapshot,
  mutation: CampaignMutation,
  access: AccessContext,
  requestedFieldGroupIdValue: unknown,
): Promise<MutationDomainEvent | null> {
  const target = statusTarget(snapshot, mutation);
  if (!target) return null;

  const requestedFieldGroupId = normalizedRequestedGroupId(requestedFieldGroupIdValue);
  const fieldSessionId =
    access.role === "field-group-member"
      ? await temporaryFieldSessionId(
          db,
          access,
          target.teamId,
          mutation.createdAt,
          requestedFieldGroupId,
        )
      : await persistentFieldSessionId(
          db,
          access,
          target.teamId,
          mutation.createdAt,
          requestedFieldGroupId,
        );

  return {
    teamId: target.teamId,
    fieldSessionId,
    entityType: target.entityType,
    entityId: target.entityId,
    eventType: "task.status.changed",
    occurredAt: mutation.createdAt,
    actorKind: access.role === "field-group-member" ? "temporary-member" : "campaign-grant",
    actorRef:
      access.role === "field-group-member"
        ? access.membershipId ?? null
        : access.grantId,
    previousStatus: target.previousStatus,
    newStatus: target.newStatus,
  };
}

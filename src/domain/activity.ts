import type { TaskStatus } from "./campaign.ts";

export const ACTIVITY_EVENT_TYPES = [
  "field_session.closed",
  "field_session.expired",
  "task.status.changed",
  "comment.created",
  "comment.edited",
  "comment.deleted",
  "automation.executed",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];
export type ActivityActorCategory =
  | "campaign-access"
  | "temporary-group"
  | "system"
  | "unknown";
export type ActivityEntityType =
  | "street-task"
  | "house-task"
  | "field-session"
  | "comment"
  | "unknown";
export type ActivityCommentTargetType =
  | "campaign"
  | "area"
  | "street-task"
  | "house-task"
  | "context";

export type ActivityDetails =
  | {
      kind: "task-status-changed";
      taskType: "street" | "house" | "unknown";
      targetLabel: string;
      contextLabel: string | null;
      previousStatus: TaskStatus | null;
      newStatus: TaskStatus | null;
    }
  | {
      kind: "field-session-closed" | "field-session-expired";
      durationSeconds: number | null;
      participantCount: number | null;
      personSeconds: number | null;
    }
  | {
      kind: "comment-created" | "comment-edited" | "comment-deleted";
      targetType: ActivityCommentTargetType;
      targetId: string | null;
      targetLabel: string;
      contextLabel: string | null;
    }
  | {
      kind: "automation-executed";
      targetLabel: string;
      contextLabel: string | null;
    };

export type ActivityItem = {
  id: string;
  eventType: ActivityEventType;
  occurredAt: string;
  teamId: string | null;
  teamLabel: string | null;
  fieldSessionId: string | null;
  entityType: ActivityEntityType;
  entityId: string | null;
  actorCategory: ActivityActorCategory;
  details: ActivityDetails;
};

export type ActivityPage = {
  activities: ActivityItem[];
  nextCursor: string | null;
};

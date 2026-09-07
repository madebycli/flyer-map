export type FieldGroupAuditKind =
  | "field_group.created"
  | "field_group.discoverability_changed"
  | "field_group.participant_count_changed"
  | "field_group.credentials_rotated"
  | "field_group.credentials_revoked"
  | "field_group.joined"
  | "field_group.member_left"
  | "field_group.member_removed"
  | "field_group.closed"
  | "field_group.expired"
  | "field_group.join_rate_limited";

export type FieldGroupAuditActorKind =
  | "campaign-grant"
  | "temporary-member"
  | "anonymous"
  | "system";

export type FieldGroupAuditInput = {
  kind: FieldGroupAuditKind;
  campaignId: string;
  groupId?: string | null;
  teamId?: string | null;
  membershipId?: string | null;
  actorKind: FieldGroupAuditActorKind;
  actorRef?: string | null;
  at?: string;
};

export type FieldGroupAuditEvent = {
  event: FieldGroupAuditKind;
  campaignId: string;
  groupId: string | null;
  teamId: string | null;
  membershipId: string | null;
  actorKind: FieldGroupAuditActorKind;
  actorRef: string | null;
  at: string;
};

export function buildFieldGroupAuditEvent(input: FieldGroupAuditInput): FieldGroupAuditEvent {
  return {
    event: input.kind,
    campaignId: input.campaignId,
    groupId: input.groupId ?? null,
    teamId: input.teamId ?? null,
    membershipId: input.membershipId ?? null,
    actorKind: input.actorKind,
    actorRef: input.actorRef ?? null,
    at: input.at ?? new Date().toISOString(),
  };
}

export function emitFieldGroupAudit(input: FieldGroupAuditInput) {
  const event = buildFieldGroupAuditEvent(input);
  console.info(JSON.stringify(event));
  return event;
}

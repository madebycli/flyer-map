import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { AccessContext } from "./access.ts";

export type WriteAuthorization =
  | { allowed: true }
  | { allowed: false; reason: string };

function same(valueA: unknown, valueB: unknown) {
  return JSON.stringify(valueA) === JSON.stringify(valueB);
}

function campaignConfigUnchanged(previous: CampaignSnapshot, next: CampaignSnapshot) {
  const { updatedAt: _previousUpdatedAt, ...previousCampaign } = previous.campaign;
  const { updatedAt: _nextUpdatedAt, ...nextCampaign } = next.campaign;
  return same(previousCampaign, nextCampaign);
}

function immutableAreaFieldsUnchanged(previous: CampaignSnapshot["areas"][number], next: CampaignSnapshot["areas"][number]) {
  return previous.id === next.id && previous.campaignId === next.campaignId && previous.teamId === next.teamId && previous.createdAt === next.createdAt;
}

/** Everything except the Abhol side (collection) and the campaign row: used to tell that a helper changed nothing outside the collection. */
function distributionSnapshotUnchanged(previous: CampaignSnapshot, next: CampaignSnapshot) {
  const { collection: _previousCollection, revision: _previousRevision, campaign: previousCampaign, ...previousRest } = previous;
  const { collection: _nextCollection, revision: _nextRevision, campaign: nextCampaign, ...nextRest } = next;
  const { updatedAt: _previousUpdatedAt, ...previousCampaignRest } = previousCampaign;
  const { updatedAt: _nextUpdatedAt, ...nextCampaignRest } = nextCampaign;
  return same({ ...previousRest, campaign: previousCampaignRest }, { ...nextRest, campaign: nextCampaignRest });
}

/**
 * Who may turn the current campaign state into the proposed one.
 * - admin: everything; viewer: nothing;
 * - collection helper: only the Abhol side;
 * - team editor: only Gebiete of their own Gruppe (no campaign settings, no Gruppen, no Gebiet of another Gruppe, no moving a Gebiet to another Gruppe), never the Abhol side.
 */
export function authorizeSnapshotWrite(access: AccessContext, previous: CampaignSnapshot, next: CampaignSnapshot): WriteAuthorization {
  const collectionChanged = !same(previous.collection ?? null, next.collection ?? null);
  if (access.campaignId !== previous.campaign.id || access.campaignId !== next.campaign.id) {
    return { allowed: false, reason: "credential_campaign_mismatch" };
  }
  if (access.role === "collection-collector") {
    if (!collectionChanged || !distributionSnapshotUnchanged(previous, next)) return { allowed: false, reason: "collection_only_write_required" };
    return { allowed: true };
  }
  if (collectionChanged && access.role !== "admin") return { allowed: false, reason: "collection_scope_forbidden" };
  if (access.role === "admin") return { allowed: true };
  if (access.role === "viewer") return { allowed: false, reason: "viewer_read_only" };
  if (access.role !== "team-editor" || !access.teamId) return { allowed: false, reason: "editor_team_scope_missing" };

  const teamId = access.teamId;
  if (!campaignConfigUnchanged(previous, next)) return { allowed: false, reason: "editor_campaign_settings_forbidden" };
  if (!same(previous.teams, next.teams)) return { allowed: false, reason: "editor_team_management_forbidden" };

  const previousAreas = new Map(previous.areas.map((area) => [area.id, area]));
  const nextAreas = new Map(next.areas.map((area) => [area.id, area]));
  for (const previousArea of previous.areas) {
    const nextArea = nextAreas.get(previousArea.id);
    if (previousArea.teamId !== teamId) {
      if (!nextArea || !same(previousArea, nextArea)) return { allowed: false, reason: "editor_foreign_area_forbidden" };
      continue;
    }
    if (nextArea && !immutableAreaFieldsUnchanged(previousArea, nextArea)) return { allowed: false, reason: "editor_area_reassignment_forbidden" };
  }
  for (const nextArea of next.areas) {
    if (!previousAreas.get(nextArea.id) && nextArea.teamId !== teamId) return { allowed: false, reason: "editor_foreign_area_create_forbidden" };
  }
  return { allowed: true };
}

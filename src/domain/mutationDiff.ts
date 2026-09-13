import type { CampaignSnapshot } from "./campaign.ts";
import { deriveCampaignMutation as deriveBaseCampaignMutation } from "./mutationDiffBase.ts";
import { derivePickupMutation } from "./pickupMutationDiff.ts";
import { derivePickupRoomMutation, withoutPickupRoomState } from "./pickupRoomMutationDiff.ts";

export { MutationDerivationError } from "./mutationDiffBase.ts";

export function deriveCampaignMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
) {
  const pickupRoomMutation = derivePickupRoomMutation(previous, next);
  if (pickupRoomMutation) return pickupRoomMutation;
  return derivePickupMutation(previous, next) ?? deriveBaseCampaignMutation(withoutPickupRoomState(previous), withoutPickupRoomState(next));
}

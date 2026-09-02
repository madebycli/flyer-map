import type { CampaignSnapshot } from "./campaign.ts";
import { deriveCampaignMutation as deriveBaseCampaignMutation } from "./mutationDiffBase.ts";
import { derivePickupMutation } from "./pickupMutationDiff.ts";

export { MutationDerivationError } from "./mutationDiffBase.ts";

export function deriveCampaignMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
) {
  return derivePickupMutation(previous, next) ?? deriveBaseCampaignMutation(previous, next);
}

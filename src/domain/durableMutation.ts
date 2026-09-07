import type { CampaignMutation } from "./mutations.ts";
import type { PickupMutation } from "./pickupMutation.ts";

export type DurableCampaignMutation = CampaignMutation | PickupMutation;

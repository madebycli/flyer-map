export * from "./mutationQueueBase.ts";

import { browserMutationQueue as baseBrowserMutationQueue } from "./mutationQueueBase.ts";
import type { DurableCampaignMutation } from "../domain/durableMutation.ts";

type PickupAwareBrowserMutationQueue = Omit<typeof baseBrowserMutationQueue, "enqueue"> & {
  enqueue(
    mutation: DurableCampaignMutation,
    context?: { fieldGroupId?: string | null },
  ): ReturnType<typeof baseBrowserMutationQueue.enqueue>;
};

export const browserMutationQueue =
  baseBrowserMutationQueue as unknown as PickupAwareBrowserMutationQueue;

import type { DurableCampaignMutation } from "../domain/durableMutation.ts";

export type CollectionMutationQueueEntry = {
  id: string;
  mutation: DurableCampaignMutation;
  enqueuedAt: string;
};

const KEY_PREFIX = "verteil-flyer:collection-mutation-queue:v1:";

function key(campaignId: string) {
  return KEY_PREFIX + encodeURIComponent(campaignId);
}

function storage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function read(campaignId: string): CollectionMutationQueueEntry[] {
  const local = storage();
  if (!local) return [];
  try {
    const value = JSON.parse(local.getItem(key(campaignId)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is CollectionMutationQueueEntry =>
      Boolean(entry) && typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).id === "string" &&
      typeof (entry as Record<string, unknown>).enqueuedAt === "string" &&
      typeof (entry as Record<string, unknown>).mutation === "object",
    );
  } catch {
    return [];
  }
}

function write(campaignId: string, entries: CollectionMutationQueueEntry[]) {
  const local = storage();
  if (!local) throw new Error("local_storage_unavailable");
  local.setItem(key(campaignId), JSON.stringify(entries));
}

export const collectionMutationQueue = {
  list(campaignId: string) {
    return read(campaignId);
  },
  enqueue(campaignId: string, mutation: DurableCampaignMutation) {
    const entries = read(campaignId);
    if (entries.some((entry) => entry.id === mutation.id)) return entries;
    entries.push({ id: mutation.id, mutation, enqueuedAt: new Date().toISOString() });
    if (entries.length > 200) throw new Error("collection_mutation_queue_full");
    write(campaignId, entries);
    return entries;
  },
  remove(campaignId: string, mutationId: string) {
    const entries = read(campaignId).filter((entry) => entry.id !== mutationId);
    write(campaignId, entries);
    return entries;
  },
};

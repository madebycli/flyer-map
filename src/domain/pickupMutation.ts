import type { LngLat } from "./campaign.ts";
import type { PickupSource, PickupStatus } from "./pickup.ts";

type PickupMutationBase<Type extends string, Payload> = {
  id: string;
  campaignId: string;
  type: Type;
  payload: Payload;
  baseRevision: number;
  createdAt: string;
};

export type PickupMutation =
  | PickupMutationBase<
      "collection.pickup.create",
      {
        pickupId: string;
        areaId: string | null;
        title: string;
        address: string;
        description: string;
        position: LngLat;
        source: PickupSource | null;
      }
    >
  | PickupMutationBase<
      "collection.pickup.update",
      {
        pickupId: string;
        areaId: string | null;
        title: string;
        address: string;
        description: string;
        position: LngLat;
        expectedUpdatedAt: string;
      }
    >
  | PickupMutationBase<
      "collection.pickup.set-status",
      {
        pickupId: string;
        status: PickupStatus;
        expectedUpdatedAt: string;
      }
    >
  | PickupMutationBase<
      "collection.pickup.archive",
      {
        pickupId: string;
        expectedUpdatedAt: string;
      }
    >
  | PickupMutationBase<
      "collection.pickup.set-assignment",
      {
        pickupId: string;
        assignedRunIds: string[];
        assignedCollectorIds: string[];
        expectedUpdatedAt: string;
      }
    >;

export type PickupMutationDraft = PickupMutation extends infer Mutation
  ? Mutation extends PickupMutation
    ? Omit<Mutation, "id" | "campaignId" | "baseRevision" | "createdAt">
    : never
  : never;

export function isPickupMutationType(value: unknown): value is PickupMutation["type"] {
  return (
    value === "collection.pickup.create" ||
    value === "collection.pickup.update" ||
    value === "collection.pickup.set-status" ||
    value === "collection.pickup.archive" ||
    value === "collection.pickup.set-assignment"
  );
}

export function createPickupMutation(
  campaignId: string,
  baseRevision: number,
  draft: PickupMutationDraft,
  options?: { id?: string; createdAt?: string },
): PickupMutation {
  return {
    ...draft,
    id: options?.id ?? `mutation_${crypto.randomUUID()}`,
    campaignId,
    baseRevision,
    createdAt: options?.createdAt ?? new Date().toISOString(),
  } as PickupMutation;
}

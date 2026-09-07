import type { CampaignSnapshot } from "./campaign.ts";
import { collectionSnapshotOrEmpty } from "./collection.ts";
import type { PickupMutation } from "./pickupMutation.ts";
import { MutationDerivationError } from "./mutationDiffBase.ts";

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedIds<T extends { id: string }>(previous: T[], next: T[]) {
  const previousMap = new Map(previous.map((value) => [value.id, value]));
  const nextMap = new Map(next.map((value) => [value.id, value]));
  return {
    added: next.filter((value) => !previousMap.has(value.id)),
    removed: previous.filter((value) => !nextMap.has(value.id)),
    changed: next
      .filter((value) => previousMap.has(value.id) && !same(previousMap.get(value.id), value))
      .map((value) => ({ previous: previousMap.get(value.id) as T, next: value })),
  };
}

function nonPickupSnapshot(snapshot: CampaignSnapshot) {
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  return {
    ...snapshot,
    revision: 0,
    campaign: { ...snapshot.campaign, updatedAt: "" },
    collection: { ...collection, pickups: [] },
  };
}

function base(
  previous: CampaignSnapshot,
  createdAt: string,
): Pick<PickupMutation, "id" | "campaignId" | "baseRevision" | "createdAt"> {
  return {
    id: `mutation_${crypto.randomUUID()}`,
    campaignId: previous.campaign.id,
    baseRevision: previous.revision,
    createdAt,
  };
}

export function derivePickupMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
): PickupMutation | null {
  const oldCollection = collectionSnapshotOrEmpty(previous.collection);
  const newCollection = collectionSnapshotOrEmpty(next.collection);
  const pickups = changedIds(oldCollection.pickups, newCollection.pickups);
  const deltaCount = pickups.added.length + pickups.removed.length + pickups.changed.length;
  if (deltaCount === 0) return null;

  if (previous.campaign.id !== next.campaign.id) {
    throw new MutationDerivationError("Pickup-Mutation darf die Campaign nicht wechseln.");
  }
  if (next.revision !== previous.revision + 1) {
    throw new MutationDerivationError("Pickup-Mutation muss die Revision genau einmal erhöhen.");
  }
  if (!same(nonPickupSnapshot(previous), nonPickupSnapshot(next))) {
    throw new MutationDerivationError(
      "Pickup und andere Domain-Daten dürfen nicht in derselben lokalen Mutation geändert werden.",
    );
  }
  if (deltaCount !== 1) {
    throw new MutationDerivationError("Eine lokale Pickup-Mutation darf genau einen Pickup ändern.");
  }
  if (pickups.removed.length > 0) {
    throw new MutationDerivationError("Pickups werden archiviert und nicht hart gelöscht.");
  }

  if (pickups.added.length === 1) {
    const pickup = pickups.added[0];
    if (
      pickup.status !== "open" ||
      pickup.archivedAt !== null ||
      pickup.assignedRunIds.length !== 0 ||
      pickup.assignedCollectorIds.length !== 0
    ) {
      throw new MutationDerivationError(
        "Neue Pickups müssen offen, aktiv und ohne Assignment erstellt werden.",
      );
    }
    return {
      ...base(previous, pickup.createdAt),
      type: "collection.pickup.create",
      payload: {
        pickupId: pickup.id,
        areaId: pickup.areaId,
        title: pickup.title,
        address: pickup.address,
        description: pickup.description,
        position: pickup.position,
        source: pickup.source,
      },
    };
  }

  const { previous: oldPickup, next: pickup } = pickups.changed[0];
  if (
    oldPickup.campaignId !== pickup.campaignId ||
    oldPickup.createdAt !== pickup.createdAt ||
    !same(oldPickup.source, pickup.source) ||
    !same(oldPickup.createdBy, pickup.createdBy)
  ) {
    throw new MutationDerivationError("Unveränderliche Pickup-Felder wurden geändert.");
  }
  if (oldPickup.archivedAt !== null) {
    throw new MutationDerivationError("Archivierte Pickups können nicht lokal verändert werden.");
  }
  if (pickup.updatedAt === oldPickup.updatedAt) {
    throw new MutationDerivationError("Pickup-Änderung benötigt einen neuen updatedAt-Zeitpunkt.");
  }

  const contentChanged =
    oldPickup.areaId !== pickup.areaId ||
    oldPickup.title !== pickup.title ||
    oldPickup.address !== pickup.address ||
    oldPickup.description !== pickup.description ||
    !same(oldPickup.position, pickup.position);
  const statusChanged = oldPickup.status !== pickup.status;
  const archiveChanged = oldPickup.archivedAt !== pickup.archivedAt;
  const assignmentChanged =
    !same(oldPickup.assignedRunIds, pickup.assignedRunIds) ||
    !same(oldPickup.assignedCollectorIds, pickup.assignedCollectorIds);
  const operationCount =
    Number(contentChanged) +
    Number(statusChanged) +
    Number(archiveChanged) +
    Number(assignmentChanged);
  if (operationCount !== 1) {
    throw new MutationDerivationError(
      "Pickup-Änderung enthält mehr als eine oder keine unterstützte Operation.",
    );
  }

  const mutationBase = base(previous, pickup.updatedAt);
  if (contentChanged) {
    return {
      ...mutationBase,
      type: "collection.pickup.update",
      payload: {
        pickupId: pickup.id,
        areaId: pickup.areaId,
        title: pickup.title,
        address: pickup.address,
        description: pickup.description,
        position: pickup.position,
        expectedUpdatedAt: oldPickup.updatedAt,
      },
    };
  }
  if (statusChanged) {
    return {
      ...mutationBase,
      type: "collection.pickup.set-status",
      payload: {
        pickupId: pickup.id,
        status: pickup.status,
        expectedUpdatedAt: oldPickup.updatedAt,
      },
    };
  }
  if (archiveChanged) {
    if (pickup.archivedAt === null || pickup.archivedAt !== pickup.updatedAt) {
      throw new MutationDerivationError(
        "Pickup-Archivierung muss archivedAt und updatedAt gemeinsam setzen.",
      );
    }
    return {
      ...mutationBase,
      type: "collection.pickup.archive",
      payload: {
        pickupId: pickup.id,
        expectedUpdatedAt: oldPickup.updatedAt,
      },
    };
  }
  return {
    ...mutationBase,
    type: "collection.pickup.set-assignment",
    payload: {
      pickupId: pickup.id,
      assignedRunIds: pickup.assignedRunIds,
      assignedCollectorIds: pickup.assignedCollectorIds,
      expectedUpdatedAt: oldPickup.updatedAt,
    },
  };
}

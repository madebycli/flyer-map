import type { CampaignSnapshot } from "./campaign.ts";
import {
  collectionSnapshotOrEmpty,
  type CollectionRoadSection,
  type CollectionRoom,
} from "./collection.ts";
import type { CampaignMutation } from "./mutations.ts";
import { MutationDerivationError } from "./mutationDiffBase.ts";

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function base(previous: CampaignSnapshot, createdAt: string): Pick<CampaignMutation, "id" | "campaignId" | "baseRevision" | "createdAt"> {
  return {
    id: `mutation_${crypto.randomUUID()}`,
    campaignId: previous.campaign.id,
    baseRevision: previous.revision,
    createdAt,
  };
}

function changedIds<T extends { id: string }>(previous: T[], next: T[]) {
  const oldById = new Map(previous.map((item) => [item.id, item]));
  const newById = new Map(next.map((item) => [item.id, item]));
  return {
    added: next.filter((item) => !oldById.has(item.id)),
    removed: previous.filter((item) => !newById.has(item.id)),
    changed: next
      .filter((item) => oldById.has(item.id) && !same(oldById.get(item.id), item))
      .map((item) => ({ previous: oldById.get(item.id) as T, next: item })),
  };
}

/** Prevent server-computed Room/progress fields from becoming fake base mutations. */
export function withoutPickupRoomState(snapshot: CampaignSnapshot): CampaignSnapshot {
  const collection = collectionSnapshotOrEmpty(snapshot.collection);
  return {
    ...snapshot,
    collection: {
      ...collection,
      areas: collection.areas.map(({ pickupState: _pickupState, roomId: _roomId, ...area }) => area),
      rooms: [],
      roadSections: [],
      progress: [],
    },
  };
}

function sectionPayload(section: CollectionRoadSection) {
  return {
    sectionId: section.id,
    areaId: section.areaId,
    label: section.label,
    geometry: section.geometry,
    sourceTaskId: section.sourceTaskId,
    sourceGeneration: section.sourceGeneration,
    source: section.source,
    smartMarking: section.smartMarking,
  };
}

function deriveSectionMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
  oldSections: CollectionRoadSection[],
  newSections: CollectionRoadSection[],
) {
  const changes = changedIds(oldSections, newSections);
  if (changes.removed.length > 0) {
    throw new MutationDerivationError("Pickup-Straßenabschnitte werden nicht hart gelöscht.");
  }
  if (changes.added.length === 1 && changes.changed.length === 0) {
    const section = changes.added[0];
    if (section.status !== "open" || section.coverage.length > 0) {
      throw new MutationDerivationError("Neue Pickup-Straßenabschnitte müssen offen und ohne Coverage starten.");
    }
    return {
      ...base(previous, section.createdAt),
      type: "collection.pickup-section.create" as const,
      payload: sectionPayload(section),
    };
  }
  if (changes.added.length > 0 || changes.changed.length !== 1) {
    throw new MutationDerivationError("Eine lokale Pickup-Änderung darf genau einen Straßenabschnitt ändern.");
  }
  const { previous: oldSection, next: section } = changes.changed[0];
  if (
    oldSection.campaignId !== section.campaignId ||
    oldSection.areaId !== section.areaId ||
    oldSection.createdAt !== section.createdAt ||
    !same(oldSection.coverage, section.coverage)
  ) {
    throw new MutationDerivationError("Unveränderliche Pickup-Straßenfelder wurden geändert.");
  }
  if (section.updatedAt === oldSection.updatedAt) {
    throw new MutationDerivationError("Pickup-Straßenänderung benötigt einen neuen updatedAt-Zeitpunkt.");
  }
  const contentChanged = !same(sectionPayload(oldSection), sectionPayload(section));
  const statusChanged = oldSection.status !== section.status;
  if (Number(contentChanged) + Number(statusChanged) !== 1) {
    throw new MutationDerivationError("Pickup-Straßenänderung enthält mehr als eine Operation.");
  }
  if (contentChanged) {
    if (oldSection.status !== "open" || section.status !== "open") {
      throw new MutationDerivationError("Nur offene Pickup-Straßenabschnitte dürfen bearbeitet werden.");
    }
    return {
      ...base(previous, section.updatedAt),
      type: "collection.pickup-section.update" as const,
      payload: { ...sectionPayload(section), expectedUpdatedAt: oldSection.updatedAt },
    };
  }
  return {
    ...base(previous, section.updatedAt),
    type: "collection.pickup-section.set-status" as const,
    payload: {
      sectionId: section.id,
      areaId: section.areaId,
      status: section.status,
      expectedUpdatedAt: oldSection.updatedAt,
      roomId: next.collection?.areas.find((area) => area.id === section.areaId)?.roomId ?? null,
    },
  };
}

function deriveRoomMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
  oldRooms: CollectionRoom[],
  newRooms: CollectionRoom[],
) {
  const changes = changedIds(oldRooms, newRooms);
  if (changes.removed.length > 0 || changes.added.length > 1 || changes.changed.length > 1) {
    throw new MutationDerivationError("Pickup Room-Änderung kann nicht eindeutig abgebildet werden.");
  }
  if (changes.added.length === 1 && changes.changed.length === 0) {
    const room = changes.added[0];
    const owner = room.participants.find((member) => member.collectorId === room.ownerCollectorId && member.leftAt === null);
    if (!owner || room.status !== "active") throw new MutationDerivationError("Pickup Room benötigt seinen aktiven Ersteller.");
    return {
      ...base(previous, room.createdAt),
      type: "collection.pickup-room.claim" as const,
      payload: { roomId: room.id, areaId: room.areaId, collectorId: room.ownerCollectorId, label: owner.label },
    };
  }
  if (changes.changed.length !== 1 || changes.added.length !== 0) {
    if (changes.added.length === 0 && changes.changed.length === 0) return null;
    throw new MutationDerivationError("Pickup Room-Änderung kann nicht eindeutig abgebildet werden.");
  }
  const { previous: oldRoom, next: room } = changes.changed[0];
  if (oldRoom.campaignId !== room.campaignId || oldRoom.areaId !== room.areaId || oldRoom.createdAt !== room.createdAt) {
    throw new MutationDerivationError("Unveränderliche Pickup Room-Felder wurden geändert.");
  }
  const addedMember = room.participants.find((member) => !oldRoom.participants.some((oldMember) => oldMember.id === member.id));
  if (oldRoom.status === "active" && room.status === "active" && addedMember) {
    return {
      ...base(previous, room.updatedAt),
      type: "collection.pickup-room.join" as const,
      payload: { roomId: room.id, areaId: room.areaId, collectorId: addedMember.collectorId, label: addedMember.label },
    };
  }
  if (oldRoom.status === "active" && room.status === "released") {
    const member = room.participants.find((candidate) => candidate.leftAt === null) ?? oldRoom.participants.find((candidate) => candidate.leftAt === null);
    if (!member) throw new MutationDerivationError("Pickup Room benötigt ein aktives Mitglied zum Freigeben.");
    return {
      ...base(previous, room.updatedAt),
      type: "collection.pickup-room.release" as const,
      payload: {
        roomId: room.id,
        areaId: room.areaId,
        collectorId: member.collectorId,
        expectedRevision: previous.revision,
        roomUpdatedAt: oldRoom.updatedAt,
        pendingSyncCount: 0,
        completenessConfirmed: true,
      },
    };
  }
  if (oldRoom.status === "active" && room.status === "completed") {
    const member = room.participants.find((candidate) => candidate.leftAt === null) ?? oldRoom.participants.find((candidate) => candidate.leftAt === null);
    if (!member) throw new MutationDerivationError("Pickup Room benötigt ein aktives Mitglied zum Abschließen.");
    return {
      ...base(previous, room.updatedAt),
      type: "collection.pickup-room.complete" as const,
      payload: {
        roomId: room.id,
        areaId: room.areaId,
        collectorId: member.collectorId,
        expectedRevision: previous.revision,
        roomUpdatedAt: oldRoom.updatedAt,
        pendingSyncCount: 0,
        completenessConfirmed: true,
      },
    };
  }
  throw new MutationDerivationError("Pickup Room-Änderung enthält keine unterstützte Operation.");
}

export function derivePickupRoomMutation(previous: CampaignSnapshot, next: CampaignSnapshot): CampaignMutation | null {
  if (previous.campaign.id !== next.campaign.id) throw new MutationDerivationError("Pickup Room darf die Campaign nicht wechseln.");
  if (next.revision !== previous.revision + 1) {
    if (same({ ...previous, revision: 0 }, { ...next, revision: 0 })) return null;
    throw new MutationDerivationError("Pickup Room-Mutation muss die Revision genau einmal erhöhen.");
  }
  const oldCollection = collectionSnapshotOrEmpty(previous.collection);
  const newCollection = collectionSnapshotOrEmpty(next.collection);
  const oldSections = oldCollection.roadSections;
  const newSections = newCollection.roadSections;
  const oldRooms = oldCollection.rooms;
  const newRooms = newCollection.rooms;
  const sectionChanged = !same(oldSections, newSections);
  const roomChanged = !same(oldRooms, newRooms);
  if (!sectionChanged && !roomChanged) return null;
  if (sectionChanged && roomChanged) throw new MutationDerivationError("Room und Straßenabschnitt dürfen nicht in derselben lokalen Mutation geändert werden.");
  const strippedPrevious = withoutPickupRoomState(previous);
  const strippedNext = withoutPickupRoomState(next);
  if (!same({ ...strippedPrevious, revision: 0 }, { ...strippedNext, revision: 0 })) {
    throw new MutationDerivationError("Pickup Room und andere Domain-Daten dürfen nicht gemeinsam geändert werden.");
  }
  return sectionChanged
    ? deriveSectionMutation(previous, next, oldSections, newSections)
    : deriveRoomMutation(previous, next, oldRooms, newRooms);
}

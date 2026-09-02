import type { CampaignSnapshot } from "./campaign.ts";

function normalizedCollection(snapshot: CampaignSnapshot) {
  const collection = snapshot.collection;
  return collection
    ? { ...collection, pickups: Array.isArray(collection.pickups) ? collection.pickups : [] }
    : { mainArea: null, areas: [], runs: [], pickups: [] };
}

function comparableSnapshot(snapshot: CampaignSnapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: 0,
    campaign: snapshot.campaign,
    teams: snapshot.teams,
    areas: snapshot.areas,
    tasks: snapshot.tasks,
    houseTasks: snapshot.houseTasks ?? [],
    collection: normalizedCollection(snapshot),
  };
}

/** Compares server/local content while treating additive empty fields consistently. */
export function sameSnapshotContent(a: CampaignSnapshot, b: CampaignSnapshot) {
  return JSON.stringify(comparableSnapshot(a)) === JSON.stringify(comparableSnapshot(b));
}

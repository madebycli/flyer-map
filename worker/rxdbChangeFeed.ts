import type { RxdbChangeFeedEntry, RxdbCollectionName, RxdbDocument } from "../src/data/rxdbSyncProtocol.ts";
import {
  documentForCollection,
  documentsForCollection,
  narrowRxdbDocument,
  toDeletedRxdbDocument,
} from "../src/data/rxdbSyncProtocol.ts";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import type { D1DatabaseLike, D1PreparedStatement } from "./campaignRepository.ts";

export type { RxdbChangeFeedEntry } from "../src/data/rxdbSyncProtocol.ts";

const CHANGE_FEED_COLUMNS = [
  "seq",
  "campaign_id",
  "collection_name",
  "document_id",
  "operation",
  "scope_team_id",
  "document_json",
  "changed_at",
] as const;

export async function hasRxdbSyncSchema(db: D1DatabaseLike) {
  try {
    const result = await db.prepare("PRAGMA table_info(campaign_sync_changes)").all<{ name: string }>();
    const columns = new Set(result.results.map((column) => column.name));
    return CHANGE_FEED_COLUMNS.every((column) => columns.has(column));
  } catch {
    return false;
  }
}

function teamScopeForDocument(
  collectionName: RxdbChangeFeedEntry["collectionName"],
  document: RxdbDocument,
  snapshot: CampaignSnapshot,
) {
  if (collectionName === "campaigns") return null;
  if (collectionName === "teams") return document.id;
  if (collectionName === "areas") return narrowRxdbDocument("areas", document)?.teamId ?? null;
  const task = collectionName === "streetTasks"
    ? narrowRxdbDocument("streetTasks", document)
    : narrowRxdbDocument("houseTasks", document);
  if (!task) return null;
  const areaId = task.areaId;
  return snapshot.areas.find((area) => area.id === areaId)?.teamId ?? null;
}

function changeFor(
  collectionName: RxdbCollectionName,
  before: CampaignSnapshot,
  after: CampaignSnapshot,
  id: string,
): RxdbChangeFeedEntry | null {
  const current = documentForCollection(collectionName, before, id);
  const next = documentForCollection(collectionName, after, id);
  if (!current && !next) return null;
  const document = next ?? (current ? toDeletedRxdbDocument(current) : null);
  if (!document) return null;
  return {
    collectionName,
    document,
    scopeTeamId: teamScopeForDocument(collectionName, document, next ? after : before),
  };
}

function wireDocumentEqual(left: RxdbDocument, right: RxdbDocument) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Builds feed entries for server-owned snapshot work that is not represented
 * by a user CampaignMutation, such as automatic Area task preparation.
 */
export function rxdbChangeFeedEntriesForSnapshotDelta(
  before: CampaignSnapshot,
  after: CampaignSnapshot,
): RxdbChangeFeedEntry[] {
  const entries: RxdbChangeFeedEntry[] = [];
  for (const collectionName of ["campaigns", "teams", "areas", "streetTasks", "houseTasks"] as const) {
    const beforeIds = new Set(documentsForCollection(collectionName, before).map((document) => document.id));
    const afterIds = new Set(documentsForCollection(collectionName, after).map((document) => document.id));
    for (const id of new Set([...beforeIds, ...afterIds])) {
      const previous = documentForCollection(collectionName, before, id);
      const next = documentForCollection(collectionName, after, id);
      if (!previous && !next) continue;
      if (previous && next && wireDocumentEqual(previous, next)) continue;
      const document = next ?? (previous ? toDeletedRxdbDocument(previous) : null);
      if (!document) continue;
      const previousScope = previous ? teamScopeForDocument(collectionName, previous, before) : null;
      const nextScope = next ? teamScopeForDocument(collectionName, next, after) : null;
      if (previous && next && previousScope !== null && nextScope !== null && previousScope !== nextScope) {
        entries.push({ collectionName, document: toDeletedRxdbDocument(previous), scopeTeamId: previousScope });
      }
      entries.push({ collectionName, document, scopeTeamId: next ? nextScope : previousScope });
    }
  }
  return entries;
}

/** Builds only the affected entity deltas, never a full Campaign snapshot feed. */
export function rxdbChangeFeedEntriesForMutation(
  before: CampaignSnapshot,
  after: CampaignSnapshot,
  mutation: CampaignMutation,
): RxdbChangeFeedEntry[] {
  const entries: RxdbChangeFeedEntry[] = [];
  const add = (collectionName: RxdbChangeFeedEntry["collectionName"], id: string) => {
    const entry = changeFor(collectionName, before, after, id);
    if (entry) entries.push(entry);
  };
  const addWithScopeTransition = (collectionName: RxdbChangeFeedEntry["collectionName"], id: string) => {
    const previous = documentForCollection(collectionName, before, id);
    const next = documentForCollection(collectionName, after, id);
    if (!previous || !next) {
      add(collectionName, id);
      return;
    }
    const previousScope = teamScopeForDocument(collectionName, previous, before);
    const nextScope = teamScopeForDocument(collectionName, next, after);
    if (previousScope !== null && nextScope !== null && previousScope !== nextScope) {
      entries.push({ collectionName, document: toDeletedRxdbDocument(previous), scopeTeamId: previousScope });
      entries.push({ collectionName, document: next, scopeTeamId: nextScope });
      return;
    }
    add(collectionName, id);
  };

  switch (mutation.type) {
    case "campaign.rename":
    case "campaign.set-default-map-view":
      add("campaigns", before.campaign.id);
      break;
    case "team.create":
    case "team.update":
    case "team.delete":
      add("teams", mutation.payload.teamId);
      break;
    case "area.create":
    case "area.rename":
    case "area.update-geometry":
      add("areas", mutation.payload.areaId);
      break;
    case "area.set-team":
      addWithScopeTransition("areas", mutation.payload.areaId);
      for (const task of before.tasks.filter((candidate) => candidate.areaId === mutation.payload.areaId)) {
        addWithScopeTransition("streetTasks", task.id);
      }
      for (const task of (before.houseTasks ?? []).filter((candidate) => candidate.areaId === mutation.payload.areaId)) {
        addWithScopeTransition("houseTasks", task.id);
      }
      break;
    case "area.delete": {
      add("areas", mutation.payload.areaId);
      for (const task of before.tasks.filter((task) => task.areaId === mutation.payload.areaId)) add("streetTasks", task.id);
      for (const task of (before.houseTasks ?? []).filter((task) => task.areaId === mutation.payload.areaId)) add("houseTasks", task.id);
      break;
    }
    case "task.create":
    case "task.rename":
    case "task.set-status":
      add("streetTasks", mutation.payload.taskId);
      break;
    case "task.delete": {
      add("streetTasks", mutation.payload.taskId);
      for (const house of after.houseTasks ?? []) {
        if (house.parentStreetTaskId === null && before.houseTasks?.some((candidate) => candidate.id === house.id && candidate.parentStreetTaskId === mutation.payload.taskId)) {
          add("houseTasks", house.id);
        }
      }
      break;
    }
    case "house.create":
    case "house.rename":
    case "house.delete":
      add("houseTasks", mutation.payload.taskId);
      break;
    case "house.set-status":
      add("houseTasks", mutation.payload.taskId);
      // Completing the last House can atomically complete its parent Street.
      // Include that server-side automation effect in the same feed batch.
      for (const task of after.tasks) {
        const previous = before.tasks.find((candidate) => candidate.id === task.id);
        if (previous && (previous.status !== task.status || previous.completedAt !== task.completedAt || previous.updatedAt !== task.updatedAt)) {
          add("streetTasks", task.id);
        }
      }
      break;
    case "house.create-batch":
      for (const house of mutation.payload.houses) add("houseTasks", house.taskId);
      break;
    default:
      // Collection/Pickup entities remain on their established specialized API path.
      break;
  }

  return entries;
}

export function rxdbChangeFeedStatements(
  db: D1DatabaseLike,
  campaignId: string,
  writeToken: string,
  changedAt: string,
  entries: readonly RxdbChangeFeedEntry[],
): D1PreparedStatement[] {
  return entries.map((entry) =>
    db
      .prepare(
        `INSERT INTO campaign_sync_changes (
           campaign_id, collection_name, document_id, operation, scope_team_id,
           document_json, changed_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)`,
      )
      .bind(
        campaignId,
        entry.collectionName,
        entry.document.id,
        entry.document._deleted ? "delete" : "upsert",
        entry.scopeTeamId,
        JSON.stringify(entry.document),
        changedAt,
        campaignId,
        writeToken,
      ),
  );
}

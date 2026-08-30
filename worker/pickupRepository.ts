import type { PickupTask } from "../src/domain/pickup.ts";
import { isPickupPosition, isPickupSource } from "../src/domain/pickup.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";

type PickupRow = {
  id: string;
  campaign_id: string;
  area_id: string | null;
  title: string;
  address: string;
  description: string;
  longitude: number;
  latitude: number;
  status: PickupTask["status"];
  archived_at: string | null;
  assigned_run_ids_json: string;
  assigned_collector_ids_json: string;
  source_json: string | null;
  created_by_kind: PickupTask["createdBy"]["kind"];
  created_by_ref: string | null;
  updated_by_kind: PickupTask["updatedBy"]["kind"];
  updated_by_ref: string | null;
  created_at: string;
  updated_at: string;
};

export class StoredPickupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoredPickupError";
  }
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export async function hasPickupReadSchema(db: D1DatabaseLike) {
  try {
    const [pickupColumns, collectorColumns] = await Promise.all([
      db.prepare("PRAGMA table_info(collection_pickups)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(collection_collectors)").all<{ name: string }>(),
    ]);
    const pickups = new Set(pickupColumns.results.map((column) => column.name));
    const collectors = new Set(collectorColumns.results.map((column) => column.name));
    return (
      pickups.has("id") &&
      pickups.has("assigned_run_ids_json") &&
      pickups.has("source_json") &&
      collectors.has("can_create_pickups") &&
      collectors.has("can_edit_pickups") &&
      collectors.has("can_assign_pickups")
    );
  } catch {
    return false;
  }
}

export async function loadPickupTasks(
  db: D1DatabaseLike,
  campaignId: string,
): Promise<PickupTask[]> {
  const result = await db
    .prepare(
      `SELECT id, campaign_id, area_id, title, address, description, longitude, latitude,
              status, archived_at, assigned_run_ids_json, assigned_collector_ids_json,
              source_json, created_by_kind, created_by_ref, updated_by_kind, updated_by_ref,
              created_at, updated_at
       FROM collection_pickups
       WHERE campaign_id = ?
       ORDER BY created_at, id`,
    )
    .bind(campaignId)
    .all<PickupRow>();

  return result.results.map((row) => {
    let assignedRunIds: unknown;
    let assignedCollectorIds: unknown;
    let source: unknown = null;
    try {
      assignedRunIds = JSON.parse(row.assigned_run_ids_json);
      assignedCollectorIds = JSON.parse(row.assigned_collector_ids_json);
      source = row.source_json ? JSON.parse(row.source_json) : null;
    } catch {
      throw new StoredPickupError("Gespeicherte Pickup-JSON-Daten sind ungültig.");
    }

    const position: [number, number] = [row.longitude, row.latitude];
    if (
      !isPickupPosition(position) ||
      !isStringArray(assignedRunIds) ||
      new Set(assignedRunIds).size !== assignedRunIds.length ||
      !isStringArray(assignedCollectorIds) ||
      new Set(assignedCollectorIds).size !== assignedCollectorIds.length ||
      !isPickupSource(source) ||
      (row.status !== "open" &&
        row.status !== "collected" &&
        row.status !== "unavailable" &&
        row.status !== "needs-follow-up") ||
      (row.created_by_kind !== "campaign-grant" && row.created_by_kind !== "collection-collector") ||
      (row.updated_by_kind !== "campaign-grant" && row.updated_by_kind !== "collection-collector")
    ) {
      throw new StoredPickupError("Gespeicherter Pickup verletzt den FC5.2-Domainvertrag.");
    }

    return {
      id: row.id,
      campaignId: row.campaign_id,
      areaId: row.area_id,
      title: row.title,
      address: row.address,
      description: row.description,
      position,
      status: row.status,
      archivedAt: row.archived_at,
      assignedRunIds: assignedRunIds as string[],
      assignedCollectorIds: assignedCollectorIds as string[],
      source,
      createdBy: { kind: row.created_by_kind, ref: row.created_by_ref },
      updatedBy: { kind: row.updated_by_kind, ref: row.updated_by_ref },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } satisfies PickupTask;
  });
}

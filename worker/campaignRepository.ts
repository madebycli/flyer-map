import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import type { CollectionArea, CollectionMainArea, CollectionRun, CollectionRunMember, CollectionSnapshot } from "../src/domain/collection.ts";

export type D1RunResult = {
  success: boolean;
  meta?: { changes?: number };
  results?: unknown[];
};

export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1RunResult[]>;
};

type CampaignRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  revision: number;
  map_center_lng: number | null;
  map_center_lat: number | null;
  map_zoom: number | null;
  map_bearing: number | null;
  created_at: string;
  updated_at: string;
};

type TeamRow = {
  id: string;
  campaign_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

type AreaRow = {
  id: string;
  campaign_id: string;
  team_id: string;
  name: string;
  geometry_json: string;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  campaign_id: string;
  area_id: string;
  task_type: "street";
  label: string;
  geometry_json: string;
  source_json: string | null;
  area_preparation_generation: string | null;
  status: "open" | "completed" | "later" | "not-deliverable";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};


type CollectionMainAreaRow = {
  id: string; campaign_id: string; name: string; geometry_json: string;
  created_at: string; updated_at: string;
};
type CollectionAreaRow = {
  id: string; campaign_id: string; main_area_id: string; name: string;
  geometry_json: string; color: string; status: CollectionArea["status"];
  run_id: string | null; claimed_by_collector_id: string | null;
  claimed_by_label: string | null; completed_at: string | null;
  created_at: string; updated_at: string;
};
type CollectionRunRow = {
  id: string; campaign_id: string; main_area_id: string; status: CollectionRun["status"];
  started_at: string; ended_at: string | null; created_by_collector_id: string;
  area_ids_json: string; created_at: string; updated_at: string;
};
type CollectionMemberRow = {
  id: string; run_id: string; campaign_id: string; collector_id: string;
  label: string; joined_at: string; left_at: string | null;
};

type HouseTaskRow = {
  id: string;
  campaign_id: string;
  area_id: string;
  parent_street_task_id: string | null;
  label: string;
  geometry_json: string;
  source_json: string | null;
  area_preparation_generation: string | null;
  status: "open" | "completed" | "later" | "not-deliverable";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export class StoredSnapshotError extends Error {}

export async function getCampaignRevision(db: D1DatabaseLike, campaignId: string) {
  const row = await db
    .prepare("SELECT revision FROM campaigns WHERE id = ?")
    .bind(campaignId)
    .first<{ revision: number }>();

  return row?.revision ?? null;
}

export async function campaignExists(db: D1DatabaseLike, campaignId: string) {
  return (await getCampaignRevision(db, campaignId)) !== null;
}

export async function hasTaskSourceProvenanceColumn(db: D1DatabaseLike) {
  const result = await db
    .prepare("PRAGMA table_info(tasks)")
    .all<{ name: string }>();
  return result.results.some((column) => column.name === "source_json");
}


export async function hasCollectionSchema(db: D1DatabaseLike) {
  const result = await db.prepare("PRAGMA table_info(collection_main_areas)").all<{ name: string }>();
  return result.results.some((column) => column.name === "id");
}

export async function hasHouseTasksTable(db: D1DatabaseLike) {
  const result = await db
    .prepare("PRAGMA table_info(house_tasks)")
    .all<{ name: string }>();
  return result.results.some((column) => column.name === "id");
}

/** True only after prepared migrations 0014 and 0015 have been applied as a complete unit. */
export async function hasAreaTaskPreparationSchema(db: D1DatabaseLike) {
  const [preparations, tasks, houses] = await Promise.all([
    db.prepare("PRAGMA table_info(area_task_preparations)").all<{ name: string }>(),
    db.prepare("PRAGMA table_info(tasks)").all<{ name: string }>(),
    db.prepare("PRAGMA table_info(house_tasks)").all<{ name: string }>(),
  ]);
  const preparationColumns = new Set(preparations.results.map((column) => column.name));
  return (
    [
      "campaign_id",
      "area_id",
      "geometry_hash",
      "generation",
      "status",
      "road_count",
      "house_count",
      "source_timestamp",
      "started_at",
      "ready_at",
      "failed_at",
      "last_error_code",
      "updated_at",
      "street_status",
      "house_status",
      "street_source_timestamp",
      "house_source_timestamp",
      "street_started_at",
      "house_started_at",
      "street_ready_at",
      "house_ready_at",
      "street_failed_at",
      "house_failed_at",
      "street_error_code",
      "house_error_code",
    ].every((column) => preparationColumns.has(column)) &&
    tasks.results.some((column) => column.name === "area_preparation_generation") &&
    houses.results.some((column) => column.name === "area_preparation_generation")
  );
}

export async function loadCampaignSnapshot(
  db: D1DatabaseLike,
  campaignId: string,
): Promise<CampaignSnapshot | null> {
  const campaign = await db
    .prepare(
      `SELECT id, name, status, revision,
              map_center_lng, map_center_lat, map_zoom, map_bearing,
              created_at, updated_at
       FROM campaigns WHERE id = ?`,
    )
    .bind(campaignId)
    .first<CampaignRow>();

  if (!campaign) return null;

  const [hasTaskSource, hasHouses, hasCollection, hasPreparation] = await Promise.all([
    hasTaskSourceProvenanceColumn(db),
    hasHouseTasksTable(db),
    hasCollectionSchema(db),
    hasAreaTaskPreparationSchema(db),
  ]);
  const taskSelect = hasTaskSource
    ? hasPreparation
      ? "SELECT id, campaign_id, area_id, task_type, label, geometry_json, source_json, area_preparation_generation, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id"
      : "SELECT id, campaign_id, area_id, task_type, label, geometry_json, source_json, NULL AS area_preparation_generation, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id"
    : hasPreparation
      ? "SELECT id, campaign_id, area_id, task_type, label, geometry_json, NULL AS source_json, area_preparation_generation, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id"
      : "SELECT id, campaign_id, area_id, task_type, label, geometry_json, NULL AS source_json, NULL AS area_preparation_generation, status, completed_at, created_at, updated_at FROM tasks WHERE campaign_id = ? ORDER BY created_at, id";

  const houseSelect = hasPreparation
    ? "SELECT id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json, area_preparation_generation, status, completed_at, created_at, updated_at FROM house_tasks WHERE campaign_id = ? ORDER BY created_at, id"
    : "SELECT id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json, NULL AS area_preparation_generation, status, completed_at, created_at, updated_at FROM house_tasks WHERE campaign_id = ? ORDER BY created_at, id";

  const housePromise = hasHouses
    ? db
        .prepare(houseSelect)
        .bind(campaignId)
        .all<HouseTaskRow>()
    : Promise.resolve({ results: [] as HouseTaskRow[] });


  const collectionPromise = hasCollection
    ? Promise.all([
        db.prepare(
          "SELECT id, campaign_id, name, geometry_json, created_at, updated_at FROM collection_main_areas WHERE campaign_id = ?",
        ).bind(campaignId).all<CollectionMainAreaRow>(),
        db.prepare(
          "SELECT id, campaign_id, main_area_id, name, geometry_json, color, status, run_id, claimed_by_collector_id, claimed_by_label, completed_at, created_at, updated_at FROM collection_areas WHERE campaign_id = ? ORDER BY created_at, id",
        ).bind(campaignId).all<CollectionAreaRow>(),
        db.prepare(
          "SELECT id, campaign_id, main_area_id, status, started_at, ended_at, created_by_collector_id, area_ids_json, created_at, updated_at FROM collection_runs WHERE campaign_id = ? ORDER BY started_at, id",
        ).bind(campaignId).all<CollectionRunRow>(),
        db.prepare(
          "SELECT id, run_id, campaign_id, collector_id, label, joined_at, left_at FROM collection_run_members WHERE campaign_id = ? ORDER BY joined_at, id",
        ).bind(campaignId).all<CollectionMemberRow>(),
      ])
    : Promise.resolve(null);

  const [teamResult, areaResult, taskResult, houseResult] = await Promise.all([
    db
      .prepare(
        "SELECT id, campaign_id, name, color, created_at, updated_at FROM teams WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<TeamRow>(),
    db
      .prepare(
        "SELECT id, campaign_id, team_id, name, geometry_json, created_at, updated_at FROM areas WHERE campaign_id = ? ORDER BY created_at, id",
      )
      .bind(campaignId)
      .all<AreaRow>(),
    db.prepare(taskSelect).bind(campaignId).all<TaskRow>(),
    housePromise,
  ]);
  const collectionResult = await collectionPromise;


    const collection = collectionResult
      ? (() => {
          const [mainResult, areaResult, runResult, memberResult] = collectionResult;
          const main = mainResult.results[0];
          const areas = areaResult.results.map((area): CollectionArea => ({
            id: area.id,
            campaignId: area.campaign_id,
            mainAreaId: area.main_area_id,
            name: area.name,
            geometry: JSON.parse(area.geometry_json),
            color: area.color,
            status: area.status,
            runId: area.run_id,
            claimedByCollectorId: area.claimed_by_collector_id,
            claimedByLabel: area.claimed_by_label,
            completedAt: area.completed_at,
            createdAt: area.created_at,
            updatedAt: area.updated_at,
          }));
          const membersByRun = new Map<string, CollectionMemberRow[]>();
          for (const member of memberResult.results) {
            const members = membersByRun.get(member.run_id) ?? [];
            members.push(member);
            membersByRun.set(member.run_id, members);
          }
          return {
            mainArea: main ? ({
              id: main.id,
              campaignId: main.campaign_id,
              name: main.name,
              geometry: JSON.parse(main.geometry_json),
              createdAt: main.created_at,
              updatedAt: main.updated_at,
            } satisfies CollectionMainArea) : null,
            areas,
            runs: runResult.results.map((run): CollectionRun => ({
              id: run.id,
              campaignId: run.campaign_id,
              mainAreaId: run.main_area_id,
              status: run.status,
              startedAt: run.started_at,
              endedAt: run.ended_at,
              createdByCollectorId: run.created_by_collector_id,
              areaIds: areas.filter((area) => area.runId === run.id).map((area) => area.id),
              members: (membersByRun.get(run.id) ?? []).map((member): CollectionRunMember => ({
                id: member.id,
                runId: member.run_id,
                collectorId: member.collector_id,
                label: member.label,
                joinedAt: member.joined_at,
                leftAt: member.left_at,
              })),
              createdAt: run.created_at,
              updatedAt: run.updated_at,
            })),
          } satisfies CollectionSnapshot;
        })()
      : null;

  const hasDefaultMapView =
    campaign.map_center_lng !== null &&
    campaign.map_center_lat !== null &&
    campaign.map_zoom !== null;

  try {
    return {
      schemaVersion: 3,
      revision: campaign.revision,
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        defaultMapView: hasDefaultMapView
          ? {
              center: [campaign.map_center_lng as number, campaign.map_center_lat as number],
              zoom: campaign.map_zoom as number,
              bearing: campaign.map_bearing ?? 0,
            }
          : null,
        createdAt: campaign.created_at,
        updatedAt: campaign.updated_at,
      },
      teams: teamResult.results.map((team) => ({
        id: team.id,
        campaignId: team.campaign_id,
        name: team.name,
        color: team.color,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      })),
      areas: areaResult.results.map((area) => ({
        id: area.id,
        campaignId: area.campaign_id,
        teamId: area.team_id,
        name: area.name,
        geometry: JSON.parse(area.geometry_json),
        createdAt: area.created_at,
        updatedAt: area.updated_at,
      })),
      tasks: taskResult.results.map((task) => ({
        id: task.id,
        campaignId: task.campaign_id,
        areaId: task.area_id,
        taskType: task.task_type,
        label: task.label,
        geometry: JSON.parse(task.geometry_json),
        ...(task.source_json ? { source: JSON.parse(task.source_json) } : {}),
        areaPreparationGeneration: task.area_preparation_generation ?? null,
        status: task.status,
        completedAt: task.completed_at,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
      })),
      ...(hasHouses
        ? {
            houseTasks: houseResult.results.map((task) => ({
              id: task.id,
              campaignId: task.campaign_id,
              areaId: task.area_id,
              taskType: "house" as const,
              label: task.label,
              geometry: JSON.parse(task.geometry_json),
              ...(task.source_json ? { source: JSON.parse(task.source_json) } : {}),
              areaPreparationGeneration: task.area_preparation_generation ?? null,
              parentStreetTaskId: task.parent_street_task_id,
              status: task.status,
              completedAt: task.completed_at,
              createdAt: task.created_at,
              updatedAt: task.updated_at,
            })),
          }
        : {}),
      ...(hasCollection ? { collection: collection as CollectionSnapshot } : {}),
    };
  } catch {
    throw new StoredSnapshotError("Stored campaign geometry or Task provenance is not valid JSON.");
  }
}

function guardExistsSql() {
  return "EXISTS (SELECT 1 FROM campaigns WHERE id = ? AND write_token = ?)";
}

function insertInitialTeams(db: D1DatabaseLike, snapshot: CampaignSnapshot, writeToken: string) {
  return db
    .prepare(
      `INSERT INTO teams (id, campaign_id, name, color, created_at, updated_at)
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.name'),
         json_extract(value, '$.color'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`,
    )
    .bind(JSON.stringify(snapshot.teams), snapshot.campaign.id, writeToken);
}

function insertInitialAreas(db: D1DatabaseLike, snapshot: CampaignSnapshot, writeToken: string) {
  return db
    .prepare(
      `INSERT INTO areas (id, campaign_id, team_id, name, geometry_json, created_at, updated_at)
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.teamId'),
         json_extract(value, '$.name'),
         json_extract(value, '$.geometry'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`,
    )
    .bind(JSON.stringify(snapshot.areas), snapshot.campaign.id, writeToken);
}

function insertInitialTasks(
  db: D1DatabaseLike,
  snapshot: CampaignSnapshot,
  writeToken: string,
  hasTaskSource: boolean,
  hasPreparation: boolean,
) {
  const query =
    hasTaskSource && hasPreparation
      ? `INSERT INTO tasks (
           id, campaign_id, area_id, task_type, label, geometry_json, source_json,
           area_preparation_generation, status, completed_at, created_at, updated_at
         )
         SELECT
           json_extract(value, '$.id'),
           json_extract(value, '$.campaignId'),
           json_extract(value, '$.areaId'),
           json_extract(value, '$.taskType'),
           json_extract(value, '$.label'),
           json_extract(value, '$.geometry'),
           CASE
             WHEN json_type(value, '$.source') IS NULL THEN NULL
             ELSE json_extract(value, '$.source')
           END,
           json_extract(value, '$.areaPreparationGeneration'),
           json_extract(value, '$.status'),
           json_extract(value, '$.completedAt'),
           json_extract(value, '$.createdAt'),
           json_extract(value, '$.updatedAt')
         FROM json_each(?)
         WHERE ${guardExistsSql()}`
      : hasTaskSource
        ? `INSERT INTO tasks (
             id, campaign_id, area_id, task_type, label, geometry_json, source_json,
             status, completed_at, created_at, updated_at
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.campaignId'),
             json_extract(value, '$.areaId'),
             json_extract(value, '$.taskType'),
             json_extract(value, '$.label'),
             json_extract(value, '$.geometry'),
             CASE
               WHEN json_type(value, '$.source') IS NULL THEN NULL
               ELSE json_extract(value, '$.source')
             END,
             json_extract(value, '$.status'),
             json_extract(value, '$.completedAt'),
             json_extract(value, '$.createdAt'),
             json_extract(value, '$.updatedAt')
           FROM json_each(?)
           WHERE ${guardExistsSql()}`
        : `INSERT INTO tasks (
             id, campaign_id, area_id, task_type, label, geometry_json,
             status, completed_at, created_at, updated_at
           )
           SELECT
             json_extract(value, '$.id'),
             json_extract(value, '$.campaignId'),
             json_extract(value, '$.areaId'),
             json_extract(value, '$.taskType'),
             json_extract(value, '$.label'),
             json_extract(value, '$.geometry'),
             json_extract(value, '$.status'),
             json_extract(value, '$.completedAt'),
             json_extract(value, '$.createdAt'),
             json_extract(value, '$.updatedAt')
           FROM json_each(?)
           WHERE ${guardExistsSql()}`;

  return db
    .prepare(query)
    .bind(JSON.stringify(snapshot.tasks), snapshot.campaign.id, writeToken);
}

function insertInitialHouseTasks(
  db: D1DatabaseLike,
  snapshot: CampaignSnapshot,
  writeToken: string,
  hasPreparation: boolean,
) {
  const query = hasPreparation
    ? `INSERT INTO house_tasks (
         id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
         area_preparation_generation, status, completed_at, created_at, updated_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.areaId'),
         json_extract(value, '$.parentStreetTaskId'),
         json_extract(value, '$.label'),
         json_extract(value, '$.geometry'),
         CASE
           WHEN json_type(value, '$.source') IS NULL THEN NULL
           ELSE json_extract(value, '$.source')
         END,
         json_extract(value, '$.areaPreparationGeneration'),
         json_extract(value, '$.status'),
         json_extract(value, '$.completedAt'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`
    : `INSERT INTO house_tasks (
         id, campaign_id, area_id, parent_street_task_id, label, geometry_json, source_json,
         status, completed_at, created_at, updated_at
       )
       SELECT
         json_extract(value, '$.id'),
         json_extract(value, '$.campaignId'),
         json_extract(value, '$.areaId'),
         json_extract(value, '$.parentStreetTaskId'),
         json_extract(value, '$.label'),
         json_extract(value, '$.geometry'),
         CASE
           WHEN json_type(value, '$.source') IS NULL THEN NULL
           ELSE json_extract(value, '$.source')
         END,
         json_extract(value, '$.status'),
         json_extract(value, '$.completedAt'),
         json_extract(value, '$.createdAt'),
         json_extract(value, '$.updatedAt')
       FROM json_each(?)
       WHERE ${guardExistsSql()}`;

  return db
    .prepare(query)
    .bind(JSON.stringify(snapshot.houseTasks ?? []), snapshot.campaign.id, writeToken);
}

export type CreateInitialCampaignStateResult =
  | { ok: true; revision: 0 }
  | {
      ok: false;
      reason: "campaign_exists" | "initial_revision_invalid" | "schema_migration_required";
    };

export async function createInitialCampaignState(
  db: D1DatabaseLike,
  snapshot: CampaignSnapshot,
): Promise<CreateInitialCampaignStateResult> {
  if (snapshot.revision !== 0) {
    return { ok: false, reason: "initial_revision_invalid" };
  }

  const [hasTaskSource, hasHouses, hasPreparation] = await Promise.all([
    hasTaskSourceProvenanceColumn(db),
    hasHouseTasksTable(db),
    hasAreaTaskPreparationSchema(db),
  ]);
  if (!hasTaskSource && snapshot.tasks.some((task) => task.source)) {
    return { ok: false, reason: "schema_migration_required" };
  }
  if (!hasHouses && (snapshot.houseTasks?.length ?? 0) > 0) {
    return { ok: false, reason: "schema_migration_required" };
  }
  if (
    !hasPreparation &&
    [...snapshot.tasks, ...(snapshot.houseTasks ?? [])].some(
      (task) => task.areaPreparationGeneration !== undefined && task.areaPreparationGeneration !== null,
    )
  ) {
    return { ok: false, reason: "schema_migration_required" };
  }

  const writeToken = crypto.randomUUID();
  const mapView = snapshot.campaign.defaultMapView;
  const claim = db
    .prepare(
      `INSERT OR IGNORE INTO campaigns (
         id, name, status, revision, write_token,
         map_center_lng, map_center_lat, map_zoom, map_bearing,
         created_at, updated_at
       ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      snapshot.campaign.id,
      snapshot.campaign.name,
      snapshot.campaign.status,
      writeToken,
      mapView?.center[0] ?? null,
      mapView?.center[1] ?? null,
      mapView?.zoom ?? null,
      mapView?.bearing ?? null,
      snapshot.campaign.createdAt,
      snapshot.campaign.updatedAt,
    );

  // D1 batches are atomic. The internal token makes all child INSERTs no-ops
  // if the create claim lost the campaign-id race.
  const childStatements: D1PreparedStatement[] = [
    insertInitialTeams(db, snapshot, writeToken),
    insertInitialAreas(db, snapshot, writeToken),
    insertInitialTasks(db, snapshot, writeToken, hasTaskSource, hasPreparation),
  ];
  if (hasHouses) {
    childStatements.push(insertInitialHouseTasks(db, snapshot, writeToken, hasPreparation));
  }

  const results = await db.batch([claim, ...childStatements]);
  if ((results[0]?.meta?.changes ?? 0) !== 1) {
    return { ok: false, reason: "campaign_exists" };
  }

  return { ok: true, revision: 0 };
}

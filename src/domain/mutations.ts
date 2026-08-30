import { collectionSnapshotOrEmpty } from "./collection";
import type { CampaignSnapshot,
  LineStringGeometry,
  MapCameraView,
  PolygonGeometry,
  TaskSourceProvenance,
  TaskStatus,
} from "./campaign";

type MutationBase<Type extends string, Payload> = {
  id: string;
  campaignId: string;
  type: Type;
  payload: Payload;
  baseRevision: number;
  createdAt: string;
};

export const HOUSE_CREATE_BATCH_MAX = 50;

export type HouseCreateMutationEntry = {
  taskId: string;
  areaId: string;
  label: string;
  geometry: PolygonGeometry;
  source?: TaskSourceProvenance | null;
  parentStreetTaskId: string | null;
};

export type CampaignMutation =
  | MutationBase<"campaign.rename", { name: string; expectedName: string }>
  | MutationBase<
      "campaign.set-default-map-view",
      { defaultMapView: MapCameraView | null; expectedDefaultMapView: MapCameraView | null }
    >
  | MutationBase<"team.create", { teamId: string; name: string; color: string }>
  | MutationBase<
      "team.update",
      { teamId: string; name?: string; color?: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "area.create",
      { areaId: string; teamId: string; name: string; geometry: PolygonGeometry }
    >
  | MutationBase<
      "area.rename",
      { areaId: string; name: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "area.set-team",
      { areaId: string; teamId: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "area.update-geometry",
      { areaId: string; geometry: PolygonGeometry; expectedUpdatedAt: string }
    >
  | MutationBase<"area.delete", { areaId: string; expectedUpdatedAt: string }>
  | MutationBase<
      "task.create",
      {
        taskId: string;
        areaId: string;
        label: string;
        geometry: LineStringGeometry;
        source?: TaskSourceProvenance | null;
      }
    >
  | MutationBase<
      "task.rename",
      { taskId: string; label: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "task.set-status",
      {
        taskId: string;
        status: TaskStatus;
        completedAt: string | null;
        expectedUpdatedAt: string;
      }
    >
  | MutationBase<"task.delete", { taskId: string; expectedUpdatedAt: string }>
  | MutationBase<
      "house.create",
      HouseCreateMutationEntry
    >
  | MutationBase<"house.create-batch", { houses: HouseCreateMutationEntry[] }>
  | MutationBase<
      "house.rename",
      { taskId: string; label: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "house.set-status",
      {
        taskId: string;
        status: TaskStatus;
        completedAt: string | null;
        expectedUpdatedAt: string;
      }
    >
  | MutationBase<"house.delete", { taskId: string; expectedUpdatedAt: string }>
  | MutationBase<
      "collection.main-area.create",
      { mainAreaId: string; name: string; geometry: PolygonGeometry }
    >
  | MutationBase<
      "collection.main-area.update",
      { mainAreaId: string; name: string; geometry: PolygonGeometry; expectedUpdatedAt: string }
    >
  | MutationBase<
      "collection.area.create",
      { areaId: string; mainAreaId: string; name: string; geometry: PolygonGeometry; color: string }
    >
  | MutationBase<
      "collection.area.update",
      { areaId: string; name: string; geometry: PolygonGeometry; color: string; expectedUpdatedAt: string }
    >
  | MutationBase<"collection.area.archive", { areaId: string; expectedUpdatedAt: string }>
  | MutationBase<
      "collection.run.start",
      { runId: string; memberId: string; mainAreaId: string; collectorId: string; label: string }
    >
  | MutationBase<
      "collection.run.claim-areas",
      { runId: string; collectorId: string; collectorLabel: string; areaIds: string[] }
    >
  | MutationBase<
      "collection.run.start-area",
      { runId: string; collectorId: string; areaId: string }
    >
  | MutationBase<
      "collection.run.join",
      { runId: string; memberId: string; collectorId: string; label: string }
    >
  | MutationBase<"collection.run.leave", { runId: string; collectorId: string }>
  | MutationBase<
      "collection.run.release-area",
      { runId: string; areaId: string; collectorId: string }
    >
  | MutationBase<
      "collection.admin.force-release-area",
      { runId: string; areaId: string; adminId: string }
    >
  | MutationBase<
      "collection.run.complete-area",
      { runId: string; areaId: string; collectorId: string }
    >
  | MutationBase<"collection.run.close", { runId: string; collectorId: string }>
  | MutationBase<"collection.run.cancel", { runId: string; collectorId: string }>;

export type CollectionMutation = Extract<CampaignMutation, { type: `collection.${string}` }>;

export type CampaignMutationDraft = CampaignMutation extends infer Mutation
  ? Mutation extends CampaignMutation
    ? Omit<Mutation, "id" | "campaignId" | "baseRevision" | "createdAt">
    : never
  : never;

export class CampaignMutationConflictError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "CampaignMutationConflictError";
    this.reason = reason;
  }
}

function conflict(reason: string): never {
  throw new CampaignMutationConflictError(reason);
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function requireExpectedUpdatedAt(
  actual: string | undefined,
  expected: string,
  missingReason: string,
  changedReason: string,
) {
  if (actual === undefined) conflict(missingReason);
  if (actual !== expected) conflict(changedReason);
}

export function createCampaignMutation(
  snapshot: CampaignSnapshot,
  draft: CampaignMutationDraft,
  options?: { id?: string; createdAt?: string },
): CampaignMutation {
  return {
    ...draft,
    id: options?.id ?? `mutation_${crypto.randomUUID()}`,
    campaignId: snapshot.campaign.id,
    baseRevision: snapshot.revision,
    createdAt: options?.createdAt ?? new Date().toISOString(),
  } as CampaignMutation;
}

export function applyCampaignMutation(
  snapshot: CampaignSnapshot,
  mutation: CampaignMutation,
): CampaignSnapshot {
  if (mutation.campaignId !== snapshot.campaign.id) {
    conflict("campaign_mismatch");
  }
  if (mutation.baseRevision > snapshot.revision) {
    conflict("base_revision_ahead");
  }

  let next: CampaignSnapshot = snapshot;

  switch (mutation.type) {
    case "campaign.rename": {
      if (snapshot.campaign.name !== mutation.payload.expectedName) {
        conflict("campaign_name_changed");
      }
      next = {
        ...snapshot,
        campaign: { ...snapshot.campaign, name: mutation.payload.name },
      };
      break;
    }
    case "campaign.set-default-map-view": {
      if (!same(snapshot.campaign.defaultMapView, mutation.payload.expectedDefaultMapView)) {
        conflict("campaign_default_map_view_changed");
      }
      next = {
        ...snapshot,
        campaign: {
          ...snapshot.campaign,
          defaultMapView: mutation.payload.defaultMapView,
        },
      };
      break;
    }
    case "team.create": {
      if (snapshot.teams.some((team) => team.id === mutation.payload.teamId)) {
        conflict("team_already_exists");
      }
      next = {
        ...snapshot,
        teams: [
          ...snapshot.teams,
          {
            id: mutation.payload.teamId,
            campaignId: snapshot.campaign.id,
            name: mutation.payload.name,
            color: mutation.payload.color,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        ],
      };
      break;
    }
    case "team.update": {
      const team = snapshot.teams.find((candidate) => candidate.id === mutation.payload.teamId);
      requireExpectedUpdatedAt(
        team?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "team_missing",
        "team_changed",
      );
      next = {
        ...snapshot,
        teams: snapshot.teams.map((candidate) =>
          candidate.id === mutation.payload.teamId
            ? {
                ...candidate,
                ...(mutation.payload.name !== undefined ? { name: mutation.payload.name } : {}),
                ...(mutation.payload.color !== undefined ? { color: mutation.payload.color } : {}),
                updatedAt: mutation.createdAt,
              }
            : candidate,
        ),
      };
      break;
    }
    case "area.create": {
      if (snapshot.areas.some((area) => area.id === mutation.payload.areaId)) {
        conflict("area_already_exists");
      }
      if (!snapshot.teams.some((team) => team.id === mutation.payload.teamId)) {
        conflict("area_team_missing");
      }
      next = {
        ...snapshot,
        areas: [
          ...snapshot.areas,
          {
            id: mutation.payload.areaId,
            campaignId: snapshot.campaign.id,
            teamId: mutation.payload.teamId,
            name: mutation.payload.name,
            geometry: mutation.payload.geometry,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        ],
      };
      break;
    }
    case "area.rename": {
      const area = snapshot.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "area_missing",
        "area_changed",
      );
      next = {
        ...snapshot,
        areas: snapshot.areas.map((candidate) =>
          candidate.id === mutation.payload.areaId
            ? { ...candidate, name: mutation.payload.name, updatedAt: mutation.createdAt }
            : candidate,
        ),
      };
      break;
    }
    case "area.set-team": {
      const area = snapshot.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "area_missing",
        "area_changed",
      );
      if (!snapshot.teams.some((team) => team.id === mutation.payload.teamId)) {
        conflict("area_team_missing");
      }
      next = {
        ...snapshot,
        areas: snapshot.areas.map((candidate) =>
          candidate.id === mutation.payload.areaId
            ? { ...candidate, teamId: mutation.payload.teamId, updatedAt: mutation.createdAt }
            : candidate,
        ),
      };
      break;
    }
    case "area.update-geometry": {
      const area = snapshot.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "area_missing",
        "area_changed",
      );
      next = {
        ...snapshot,
        areas: snapshot.areas.map((candidate) =>
          candidate.id === mutation.payload.areaId
            ? {
                ...candidate,
                geometry: mutation.payload.geometry,
                updatedAt: mutation.createdAt,
              }
            : candidate,
        ),
      };
      break;
    }
    case "area.delete": {
      const area = snapshot.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "area_missing",
        "area_changed",
      );
      next = {
        ...snapshot,
        areas: snapshot.areas.filter((candidate) => candidate.id !== mutation.payload.areaId),
        tasks: snapshot.tasks.filter((task) => task.areaId !== mutation.payload.areaId),
        ...(snapshot.houseTasks
          ? { houseTasks: snapshot.houseTasks.filter((task) => task.areaId !== mutation.payload.areaId) }
          : {}),
      };
      break;
    }
    case "task.create": {
      if (
        snapshot.tasks.some((task) => task.id === mutation.payload.taskId) ||
        (snapshot.houseTasks ?? []).some((task) => task.id === mutation.payload.taskId)
      ) {
        conflict("task_already_exists");
      }
      if (!snapshot.areas.some((area) => area.id === mutation.payload.areaId)) {
        conflict("task_area_missing");
      }
      next = {
        ...snapshot,
        tasks: [
          ...snapshot.tasks,
          {
            id: mutation.payload.taskId,
            campaignId: snapshot.campaign.id,
            areaId: mutation.payload.areaId,
            taskType: "street",
            label: mutation.payload.label,
            geometry: mutation.payload.geometry,
            ...(mutation.payload.source ? { source: mutation.payload.source } : {}),
            status: "open",
            completedAt: null,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        ],
      };
      break;
    }
    case "task.rename": {
      const task = snapshot.tasks.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "task_missing",
        "task_changed",
      );
      next = {
        ...snapshot,
        tasks: snapshot.tasks.map((candidate) =>
          candidate.id === mutation.payload.taskId
            ? { ...candidate, label: mutation.payload.label, updatedAt: mutation.createdAt }
            : candidate,
        ),
      };
      break;
    }
    case "task.set-status": {
      const task = snapshot.tasks.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "task_missing",
        "task_changed",
      );
      next = {
        ...snapshot,
        tasks: snapshot.tasks.map((candidate) =>
          candidate.id === mutation.payload.taskId
            ? {
                ...candidate,
                status: mutation.payload.status,
                completedAt: mutation.payload.completedAt,
                updatedAt: mutation.createdAt,
              }
            : candidate,
        ),
      };
      break;
    }
    case "task.delete": {
      const task = snapshot.tasks.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "task_missing",
        "task_changed",
      );
      next = {
        ...snapshot,
        tasks: snapshot.tasks.filter((candidate) => candidate.id !== mutation.payload.taskId),
        ...(snapshot.houseTasks
          ? {
              houseTasks: snapshot.houseTasks.map((house) =>
                house.parentStreetTaskId === mutation.payload.taskId
                  ? { ...house, parentStreetTaskId: null }
                  : house,
              ),
            }
          : {}),
      };
      break;
    }
    case "house.create": {
      const houses = snapshot.houseTasks ?? [];
      if (
        snapshot.tasks.some((task) => task.id === mutation.payload.taskId) ||
        houses.some((task) => task.id === mutation.payload.taskId)
      ) {
        conflict("task_already_exists");
      }
      if (!snapshot.areas.some((area) => area.id === mutation.payload.areaId)) {
        conflict("house_area_missing");
      }
      if (mutation.payload.parentStreetTaskId) {
        const parent = snapshot.tasks.find(
          (task) => task.id === mutation.payload.parentStreetTaskId,
        );
        if (!parent) conflict("house_parent_street_missing");
        if (parent.areaId !== mutation.payload.areaId) conflict("house_parent_area_mismatch");
      }
      next = {
        ...snapshot,
        houseTasks: [
          ...houses,
          {
            id: mutation.payload.taskId,
            campaignId: snapshot.campaign.id,
            areaId: mutation.payload.areaId,
            taskType: "house",
            label: mutation.payload.label,
            geometry: mutation.payload.geometry,
            ...(mutation.payload.source ? { source: mutation.payload.source } : {}),
            parentStreetTaskId: mutation.payload.parentStreetTaskId,
            status: "open",
            completedAt: null,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        ],
      };
      break;
    }
    case "house.create-batch": {
      const houses = snapshot.houseTasks ?? [];
      const entries = mutation.payload.houses;
      if (entries.length < 1 || entries.length > HOUSE_CREATE_BATCH_MAX) {
        conflict("house_batch_size_invalid");
      }

      const existingIds = new Set([
        ...snapshot.tasks.map((task) => task.id),
        ...houses.map((task) => task.id),
      ]);
      const newIds = new Set<string>();
      for (const entry of entries) {
        if (existingIds.has(entry.taskId) || newIds.has(entry.taskId)) {
          conflict("task_already_exists");
        }
        newIds.add(entry.taskId);
        if (!snapshot.areas.some((area) => area.id === entry.areaId)) {
          conflict("house_area_missing");
        }
        if (entry.parentStreetTaskId) {
          const parent = snapshot.tasks.find((task) => task.id === entry.parentStreetTaskId);
          if (!parent) conflict("house_parent_street_missing");
          if (parent.areaId !== entry.areaId) conflict("house_parent_area_mismatch");
        }
      }

      next = {
        ...snapshot,
        houseTasks: [
          ...houses,
          ...entries.map((entry) => ({
            id: entry.taskId,
            campaignId: snapshot.campaign.id,
            areaId: entry.areaId,
            taskType: "house" as const,
            label: entry.label,
            geometry: entry.geometry,
            ...(entry.source ? { source: entry.source } : {}),
            parentStreetTaskId: entry.parentStreetTaskId,
            status: "open" as const,
            completedAt: null,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          })),
        ],
      };
      break;
    }
    case "house.rename": {
      const houses = snapshot.houseTasks ?? [];
      const task = houses.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "house_missing",
        "house_changed",
      );
      next = {
        ...snapshot,
        houseTasks: houses.map((candidate) =>
          candidate.id === mutation.payload.taskId
            ? { ...candidate, label: mutation.payload.label, updatedAt: mutation.createdAt }
            : candidate,
        ),
      };
      break;
    }
    case "house.set-status": {
      const houses = snapshot.houseTasks ?? [];
      const task = houses.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "house_missing",
        "house_changed",
      );
      next = {
        ...snapshot,
        houseTasks: houses.map((candidate) =>
          candidate.id === mutation.payload.taskId
            ? {
                ...candidate,
                status: mutation.payload.status,
                completedAt: mutation.payload.completedAt,
                updatedAt: mutation.createdAt,
              }
            : candidate,
        ),
      };
      break;
    }
    case "house.delete": {
      const houses = snapshot.houseTasks ?? [];
      const task = houses.find((candidate) => candidate.id === mutation.payload.taskId);
      requireExpectedUpdatedAt(
        task?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "house_missing",
        "house_changed",
      );
      next = {
        ...snapshot,
        houseTasks: houses.filter((candidate) => candidate.id !== mutation.payload.taskId),
      };
      break;

    case "collection.main-area.create": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      if (collection.mainArea) conflict("collection_main_area_already_exists");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          mainArea: {
            id: mutation.payload.mainAreaId,
            campaignId: snapshot.campaign.id,
            name: mutation.payload.name,
            geometry: mutation.payload.geometry,
            createdAt: mutation.createdAt,
            updatedAt: mutation.createdAt,
          },
        },
      };
      break;
    }
    case "collection.main-area.update": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const mainArea = collection.mainArea;
      requireExpectedUpdatedAt(
        mainArea?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "collection_main_area_missing",
        "collection_main_area_changed",
      );
      if (mainArea && mainArea.id !== mutation.payload.mainAreaId) conflict("collection_main_area_missing");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          mainArea: mainArea
            ? { ...mainArea, name: mutation.payload.name, geometry: mutation.payload.geometry, updatedAt: mutation.createdAt }
            : null,
        },
      };
      break;
    }
    case "collection.area.create": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      if (!collection.mainArea || collection.mainArea.id !== mutation.payload.mainAreaId) {
        conflict("collection_main_area_missing");
      }
      if (collection.areas.some((area) => area.id === mutation.payload.areaId)) {
        conflict("collection_area_already_exists");
      }
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: [
            ...collection.areas,
            {
              id: mutation.payload.areaId,
              campaignId: snapshot.campaign.id,
              mainAreaId: mutation.payload.mainAreaId,
              name: mutation.payload.name,
              geometry: mutation.payload.geometry,
              color: mutation.payload.color,
              status: "open",
              runId: null,
              claimedByCollectorId: null,
              claimedByLabel: null,
              completedAt: null,
              createdAt: mutation.createdAt,
              updatedAt: mutation.createdAt,
            },
          ],
        },
      };
      break;
    }
    case "collection.area.update": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "collection_area_missing",
        "collection_area_changed",
      );
      if (!area) conflict("collection_area_missing");
      if (area.status !== "open") conflict("collection_area_not_editable");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id
              ? { ...candidate, name: mutation.payload.name, geometry: mutation.payload.geometry, color: mutation.payload.color, updatedAt: mutation.createdAt }
              : candidate,
          ),
        },
      };
      break;
    }
    case "collection.area.archive": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      requireExpectedUpdatedAt(
        area?.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "collection_area_missing",
        "collection_area_changed",
      );
      if (!area) conflict("collection_area_missing");
      if (area.status !== "open" || area.runId) conflict("collection_area_not_archivable");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id
              ? { ...candidate, status: "archived", updatedAt: mutation.createdAt }
              : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.start": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      if (!collection.mainArea || collection.mainArea.id !== mutation.payload.mainAreaId) {
        conflict("collection_main_area_missing");
      }
      if (collection.runs.some((run) => run.id === mutation.payload.runId)) {
        conflict("collection_run_already_exists");
      }
      next = {
        ...snapshot,
        collection: {
          ...collection,
          runs: [
            ...collection.runs,
            {
              id: mutation.payload.runId,
              campaignId: snapshot.campaign.id,
              mainAreaId: mutation.payload.mainAreaId,
              status: "active",
              startedAt: mutation.createdAt,
              endedAt: null,
              createdByCollectorId: mutation.payload.collectorId,
              areaIds: [],
              members: [{
                id: mutation.payload.memberId,
                runId: mutation.payload.runId,
                collectorId: mutation.payload.collectorId,
                label: mutation.payload.label,
                joinedAt: mutation.createdAt,
                leftAt: null,
              }],
              createdAt: mutation.createdAt,
              updatedAt: mutation.createdAt,
            },
          ],
        },
      };
      break;
    }
    case "collection.run.claim-areas": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) {
        conflict("collection_run_member_required");
      }
      if (mutation.payload.areaIds.length === 0 || new Set(mutation.payload.areaIds).size !== mutation.payload.areaIds.length) {
        conflict("collection_area_selection_invalid");
      }
      const selected = collection.areas.filter((area) => mutation.payload.areaIds.includes(area.id));
      if (selected.length !== mutation.payload.areaIds.length) conflict("collection_area_missing");
      if (selected.some((area) => area.status !== "open" || area.runId !== null)) {
        conflict("collection_area_unavailable");
      }
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((area) =>
            mutation.payload.areaIds.includes(area.id)
              ? { ...area, status: "claimed", runId: run.id, claimedByCollectorId: mutation.payload.collectorId, claimedByLabel: mutation.payload.collectorLabel, updatedAt: mutation.createdAt }
              : area,
          ),
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id
              ? { ...candidate, areaIds: [...candidate.areaIds, ...mutation.payload.areaIds], updatedAt: mutation.createdAt }
              : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.start-area": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      if (!area || area.runId !== run.id || area.status !== "claimed") conflict("collection_area_not_claimed");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id ? { ...candidate, status: "in-progress", updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.join": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (run.members.some((member) => member.collectorId === mutation.payload.collectorId)) conflict("collection_run_member_exists");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id
              ? { ...candidate, members: [...candidate.members, { id: mutation.payload.memberId, runId: run.id, collectorId: mutation.payload.collectorId, label: mutation.payload.label, joinedAt: mutation.createdAt, leftAt: null }], updatedAt: mutation.createdAt }
              : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.leave": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id
              ? { ...candidate, members: candidate.members.map((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null ? { ...member, leftAt: mutation.createdAt } : member), updatedAt: mutation.createdAt }
              : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.release-area": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      if (!area || area.runId !== run.id || area.claimedByCollectorId !== mutation.payload.collectorId || (area.status !== "claimed" && area.status !== "in-progress")) conflict("collection_area_not_releasable");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id ? { ...candidate, status: "open", runId: null, claimedByCollectorId: null, claimedByLabel: null, completedAt: null, updatedAt: mutation.createdAt } : candidate,
          ),
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id ? { ...candidate, areaIds: candidate.areaIds.filter((id) => id !== area.id), updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    case "collection.admin.force-release-area": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      if (!area || !area.runId || (area.status !== "claimed" && area.status !== "in-progress")) conflict("collection_area_not_releasable");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id ? { ...candidate, status: "open", runId: null, claimedByCollectorId: null, claimedByLabel: null, completedAt: null, updatedAt: mutation.createdAt } : candidate,
          ),
          runs: collection.runs.map((candidate) =>
            candidate.id === area.runId ? { ...candidate, areaIds: candidate.areaIds.filter((id) => id !== area.id), updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.complete-area": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      const area = collection.areas.find((candidate) => candidate.id === mutation.payload.areaId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      if (!area || area.runId !== run.id || (area.status !== "claimed" && area.status !== "in-progress")) conflict("collection_area_not_completable");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((candidate) =>
            candidate.id === area.id ? { ...candidate, status: "completed", completedAt: mutation.createdAt, updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.close": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      if (run.areaIds.some((id) => collection.areas.some((area) => area.id === id && area.status !== "completed"))) conflict("collection_run_has_open_areas");
      next = {
        ...snapshot,
        collection: {
          ...collection,
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id ? { ...candidate, status: "closed", endedAt: mutation.createdAt, updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    case "collection.run.cancel": {
      const collection = collectionSnapshotOrEmpty(snapshot.collection);
      const run = collection.runs.find((candidate) => candidate.id === mutation.payload.runId);
      if (!run || run.status !== "active") conflict("collection_run_not_active");
      if (!run.members.some((member) => member.collectorId === mutation.payload.collectorId && member.leftAt === null)) conflict("collection_run_member_required");
      const completedIds = new Set(run.areaIds.filter((id) => collection.areas.find((area) => area.id === id)?.status === "completed"));
      next = {
        ...snapshot,
        collection: {
          ...collection,
          areas: collection.areas.map((area) =>
            area.runId === run.id && area.status !== "completed"
              ? { ...area, status: "open", runId: null, claimedByCollectorId: null, claimedByLabel: null, completedAt: null, updatedAt: mutation.createdAt }
              : area,
          ),
          runs: collection.runs.map((candidate) =>
            candidate.id === run.id ? { ...candidate, status: "cancelled", endedAt: mutation.createdAt, areaIds: [...completedIds], updatedAt: mutation.createdAt } : candidate,
          ),
        },
      };
      break;
    }
    }
  }

  return {
    ...next,
    revision: snapshot.revision + 1,
    campaign: {
      ...next.campaign,
      updatedAt: mutation.createdAt,
    },
  };
}

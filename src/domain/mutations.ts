import type {
  CampaignSnapshot,
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
  | MutationBase<"house.delete", { taskId: string; expectedUpdatedAt: string }>;

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

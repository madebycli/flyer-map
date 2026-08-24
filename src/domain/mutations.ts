import type {
  CampaignSnapshot,
  LineStringGeometry,
  MapCameraView,
  PolygonGeometry,
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

export type CampaignMutation =
  | MutationBase<
      "campaign.rename",
      { name: string; expectedUpdatedAt: string }
    >
  | MutationBase<
      "campaign.set-default-map-view",
      { defaultMapView: MapCameraView | null; expectedUpdatedAt: string }
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
      { taskId: string; areaId: string; label: string; geometry: LineStringGeometry }
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
  | MutationBase<"task.delete", { taskId: string; expectedUpdatedAt: string }>;

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
      requireExpectedUpdatedAt(
        snapshot.campaign.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "campaign_missing",
        "campaign_changed",
      );
      next = {
        ...snapshot,
        campaign: { ...snapshot.campaign, name: mutation.payload.name },
      };
      break;
    }
    case "campaign.set-default-map-view": {
      requireExpectedUpdatedAt(
        snapshot.campaign.updatedAt,
        mutation.payload.expectedUpdatedAt,
        "campaign_missing",
        "campaign_changed",
      );
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
      };
      break;
    }
    case "task.create": {
      if (snapshot.tasks.some((task) => task.id === mutation.payload.taskId)) {
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

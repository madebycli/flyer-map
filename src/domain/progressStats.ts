import type {
  CampaignSnapshot,
  DistributionTask,
  HouseTask,
  TaskStatus,
} from "./campaign.ts";

export type ProgressSummary = {
  denominator: "street-tasks";
  total: number;
  completed: number;
  open: number;
  later: number;
  notDeliverable: number;
  remaining: number;
  percentCompleted: number | null;
};

export type HouseProgressSummary = Omit<ProgressSummary, "denominator"> & {
  denominator: "house-tasks";
};

export type TeamProgressSummary = ProgressSummary & {
  teamId: string;
  areaCount: number;
};

export type TeamHouseProgressSummary = HouseProgressSummary & {
  teamId: string;
  areaCount: number;
};

export type AreaProgressSummary = ProgressSummary & {
  areaId: string;
  teamId: string;
};

type StatusTask = Pick<DistributionTask | HouseTask, "status">;

function countStatus(tasks: StatusTask[], status: TaskStatus) {
  return tasks.reduce((count, task) => count + (task.status === status ? 1 : 0), 0);
}

function summarizeStatuses(tasks: StatusTask[]) {
  const total = tasks.length;
  const completed = countStatus(tasks, "completed");
  const open = countStatus(tasks, "open");
  const later = countStatus(tasks, "later");
  const notDeliverable = countStatus(tasks, "not-deliverable");

  return {
    total,
    completed,
    open,
    later,
    notDeliverable,
    remaining: total - completed,
    percentCompleted: total === 0 ? null : (completed / total) * 100,
  };
}

export function summarizeStreetTasks(tasks: DistributionTask[]): ProgressSummary {
  return {
    denominator: "street-tasks",
    ...summarizeStatuses(tasks),
  };
}

export function summarizeHouseTasks(tasks: HouseTask[]): HouseProgressSummary {
  return {
    denominator: "house-tasks",
    ...summarizeStatuses(tasks),
  };
}

export function calculateCampaignProgress(snapshot: CampaignSnapshot): ProgressSummary {
  return summarizeStreetTasks(snapshot.tasks);
}

export function calculateTeamProgress(
  snapshot: CampaignSnapshot,
  teamId: string,
): TeamProgressSummary {
  const areaIds = new Set(
    snapshot.areas.filter((area) => area.teamId === teamId).map((area) => area.id),
  );
  const summary = summarizeStreetTasks(snapshot.tasks.filter((task) => areaIds.has(task.areaId)));
  return {
    ...summary,
    teamId,
    areaCount: areaIds.size,
  };
}

export function calculateTeamHouseProgress(
  snapshot: CampaignSnapshot,
  teamId: string,
): TeamHouseProgressSummary {
  const areaIds = new Set(
    snapshot.areas.filter((area) => area.teamId === teamId).map((area) => area.id),
  );
  const summary = summarizeHouseTasks(
    (snapshot.houseTasks ?? []).filter((task) => areaIds.has(task.areaId)),
  );
  return {
    ...summary,
    teamId,
    areaCount: areaIds.size,
  };
}

export function calculateAreaProgress(
  snapshot: CampaignSnapshot,
  areaId: string,
): AreaProgressSummary | null {
  const area = snapshot.areas.find((candidate) => candidate.id === areaId);
  if (!area) return null;
  const summary = summarizeStreetTasks(snapshot.tasks.filter((task) => task.areaId === areaId));
  return {
    ...summary,
    areaId,
    teamId: area.teamId,
  };
}

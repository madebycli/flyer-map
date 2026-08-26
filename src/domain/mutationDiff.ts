import type { CampaignSnapshot } from "./campaign";
import type { CampaignMutation } from "./mutations";

export class MutationDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationDerivationError";
  }
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mutationBase(
  previous: CampaignSnapshot,
  createdAt: string,
): Pick<CampaignMutation, "id" | "campaignId" | "baseRevision" | "createdAt"> {
  return {
    id: `mutation_${crypto.randomUUID()}`,
    campaignId: previous.campaign.id,
    baseRevision: previous.revision,
    createdAt,
  };
}

function withoutCampaignUpdatedAt(snapshot: CampaignSnapshot) {
  const { updatedAt: _updatedAt, ...campaign } = snapshot.campaign;
  return campaign;
}

function changedIds<T extends { id: string }>(previous: T[], next: T[]) {
  const previousMap = new Map(previous.map((value) => [value.id, value]));
  const nextMap = new Map(next.map((value) => [value.id, value]));
  const added = next.filter((value) => !previousMap.has(value.id));
  const removed = previous.filter((value) => !nextMap.has(value.id));
  const changed = next
    .filter((value) => previousMap.has(value.id) && !same(previousMap.get(value.id), value))
    .map((value) => ({ previous: previousMap.get(value.id) as T, next: value }));
  return { added, removed, changed };
}

export function deriveCampaignMutation(
  previous: CampaignSnapshot,
  next: CampaignSnapshot,
): CampaignMutation | null {
  if (previous.campaign.id !== next.campaign.id) {
    throw new MutationDerivationError("Campaign-Wechsel kann nicht als Mutation gespeichert werden.");
  }
  if (next.revision !== previous.revision + 1) {
    if (same({ ...previous, revision: 0 }, { ...next, revision: 0 })) return null;
    throw new MutationDerivationError("Lokale Mutation muss die Revision genau einmal erhöhen.");
  }

  const campaignChanged = !same(withoutCampaignUpdatedAt(previous), withoutCampaignUpdatedAt(next));
  const teams = changedIds(previous.teams, next.teams);
  const areas = changedIds(previous.areas, next.areas);
  const tasks = changedIds(previous.tasks, next.tasks);
  const houses = changedIds(previous.houseTasks ?? [], next.houseTasks ?? []);

  const collectionDeltaCount =
    teams.added.length +
    teams.removed.length +
    teams.changed.length +
    areas.added.length +
    areas.removed.length +
    areas.changed.length +
    tasks.added.length +
    tasks.removed.length +
    tasks.changed.length +
    houses.added.length +
    houses.removed.length +
    houses.changed.length;

  if (campaignChanged && collectionDeltaCount === 0) {
    const base = mutationBase(previous, next.campaign.updatedAt);
    const nameChanged = previous.campaign.name !== next.campaign.name;
    const mapViewChanged = !same(previous.campaign.defaultMapView, next.campaign.defaultMapView);
    const statusChanged = previous.campaign.status !== next.campaign.status;
    if (statusChanged || Number(nameChanged) + Number(mapViewChanged) !== 1) {
      throw new MutationDerivationError("Campaign-Änderung enthält mehr als eine unterstützte Operation.");
    }
    if (nameChanged) {
      return {
        ...base,
        type: "campaign.rename",
        payload: {
          name: next.campaign.name,
          expectedName: previous.campaign.name,
        },
      };
    }
    return {
      ...base,
      type: "campaign.set-default-map-view",
      payload: {
        defaultMapView: next.campaign.defaultMapView,
        expectedDefaultMapView: previous.campaign.defaultMapView,
      },
    };
  }

  if (campaignChanged) {
    throw new MutationDerivationError("Campaign-Konfiguration und Domain-Daten wurden gleichzeitig geändert.");
  }

  if (teams.added.length === 1 && collectionDeltaCount === 1) {
    const team = teams.added[0];
    return {
      ...mutationBase(previous, team.createdAt),
      type: "team.create",
      payload: { teamId: team.id, name: team.name, color: team.color },
    };
  }

  if (teams.changed.length === 1 && collectionDeltaCount === 1) {
    const { previous: oldTeam, next: team } = teams.changed[0];
    const immutableChanged =
      oldTeam.campaignId !== team.campaignId || oldTeam.createdAt !== team.createdAt;
    if (immutableChanged) {
      throw new MutationDerivationError("Unveränderliche Team-Felder wurden geändert.");
    }
    const nameChanged = oldTeam.name !== team.name;
    const colorChanged = oldTeam.color !== team.color;
    if (!nameChanged && !colorChanged) return null;
    return {
      ...mutationBase(previous, team.updatedAt),
      type: "team.update",
      payload: {
        teamId: team.id,
        ...(nameChanged ? { name: team.name } : {}),
        ...(colorChanged ? { color: team.color } : {}),
        expectedUpdatedAt: oldTeam.updatedAt,
      },
    };
  }

  if (areas.added.length === 1 && collectionDeltaCount === 1) {
    const area = areas.added[0];
    return {
      ...mutationBase(previous, area.createdAt),
      type: "area.create",
      payload: {
        areaId: area.id,
        teamId: area.teamId,
        name: area.name,
        geometry: area.geometry,
      },
    };
  }

  if (areas.changed.length === 1 && collectionDeltaCount === 1) {
    const { previous: oldArea, next: area } = areas.changed[0];
    if (oldArea.campaignId !== area.campaignId || oldArea.createdAt !== area.createdAt) {
      throw new MutationDerivationError("Unveränderliche Area-Felder wurden geändert.");
    }
    const nameChanged = oldArea.name !== area.name;
    const teamChanged = oldArea.teamId !== area.teamId;
    const geometryChanged = !same(oldArea.geometry, area.geometry);
    if (Number(nameChanged) + Number(teamChanged) + Number(geometryChanged) !== 1) {
      throw new MutationDerivationError("Area-Änderung enthält mehr als eine Operation.");
    }
    const base = mutationBase(previous, area.updatedAt);
    if (nameChanged) {
      return {
        ...base,
        type: "area.rename",
        payload: {
          areaId: area.id,
          name: area.name,
          expectedUpdatedAt: oldArea.updatedAt,
        },
      };
    }
    if (teamChanged) {
      return {
        ...base,
        type: "area.set-team",
        payload: {
          areaId: area.id,
          teamId: area.teamId,
          expectedUpdatedAt: oldArea.updatedAt,
        },
      };
    }
    return {
      ...base,
      type: "area.update-geometry",
      payload: {
        areaId: area.id,
        geometry: area.geometry,
        expectedUpdatedAt: oldArea.updatedAt,
      },
    };
  }

  if (areas.removed.length === 1 && teams.added.length + teams.removed.length + teams.changed.length === 0) {
    const removedArea = areas.removed[0];
    const onlyCascadedTasksRemoved =
      areas.added.length === 0 &&
      areas.changed.length === 0 &&
      tasks.added.length === 0 &&
      tasks.changed.length === 0 &&
      tasks.removed.every((task) => task.areaId === removedArea.id) &&
      houses.added.length === 0 &&
      houses.changed.length === 0 &&
      houses.removed.every((task) => task.areaId === removedArea.id) &&
      collectionDeltaCount === 1 + tasks.removed.length + houses.removed.length;
    if (onlyCascadedTasksRemoved) {
      return {
        ...mutationBase(previous, next.campaign.updatedAt),
        type: "area.delete",
        payload: {
          areaId: removedArea.id,
          expectedUpdatedAt: removedArea.updatedAt,
        },
      };
    }
  }

  if (tasks.added.length === 1 && collectionDeltaCount === 1) {
    const task = tasks.added[0];
    return {
      ...mutationBase(previous, task.createdAt),
      type: "task.create",
      payload: {
        taskId: task.id,
        areaId: task.areaId,
        label: task.label,
        geometry: task.geometry,
        ...(task.source ? { source: task.source } : {}),
      },
    };
  }

  if (tasks.changed.length === 1 && collectionDeltaCount === 1) {
    const { previous: oldTask, next: task } = tasks.changed[0];
    if (
      oldTask.campaignId !== task.campaignId ||
      oldTask.areaId !== task.areaId ||
      oldTask.taskType !== task.taskType ||
      oldTask.createdAt !== task.createdAt ||
      !same(oldTask.geometry, task.geometry) ||
      !same(oldTask.source ?? null, task.source ?? null)
    ) {
      throw new MutationDerivationError("Unveränderliche Task-Felder wurden geändert.");
    }
    const labelChanged = oldTask.label !== task.label;
    const statusChanged = oldTask.status !== task.status || oldTask.completedAt !== task.completedAt;
    if (Number(labelChanged) + Number(statusChanged) !== 1) {
      throw new MutationDerivationError("Task-Änderung enthält mehr als eine Operation.");
    }
    const base = mutationBase(previous, task.updatedAt);
    if (labelChanged) {
      return {
        ...base,
        type: "task.rename",
        payload: {
          taskId: task.id,
          label: task.label,
          expectedUpdatedAt: oldTask.updatedAt,
        },
      };
    }
    return {
      ...base,
      type: "task.set-status",
      payload: {
        taskId: task.id,
        status: task.status,
        completedAt: task.completedAt,
        expectedUpdatedAt: oldTask.updatedAt,
      },
    };
  }

  if (tasks.removed.length === 1 && collectionDeltaCount === 1) {
    const task = tasks.removed[0];
    return {
      ...mutationBase(previous, next.campaign.updatedAt),
      type: "task.delete",
      payload: { taskId: task.id, expectedUpdatedAt: task.updatedAt },
    };
  }

  if (houses.added.length === 1 && collectionDeltaCount === 1) {
    const task = houses.added[0];
    return {
      ...mutationBase(previous, task.createdAt),
      type: "house.create",
      payload: {
        taskId: task.id,
        areaId: task.areaId,
        label: task.label,
        geometry: task.geometry,
        ...(task.source ? { source: task.source } : {}),
        parentStreetTaskId: task.parentStreetTaskId,
      },
    };
  }

  if (houses.changed.length === 1 && collectionDeltaCount === 1) {
    const { previous: oldTask, next: task } = houses.changed[0];
    if (
      oldTask.campaignId !== task.campaignId ||
      oldTask.areaId !== task.areaId ||
      oldTask.taskType !== task.taskType ||
      oldTask.createdAt !== task.createdAt ||
      oldTask.parentStreetTaskId !== task.parentStreetTaskId ||
      !same(oldTask.geometry, task.geometry) ||
      !same(oldTask.source ?? null, task.source ?? null)
    ) {
      throw new MutationDerivationError("Unveränderliche House-Task-Felder wurden geändert.");
    }
    const labelChanged = oldTask.label !== task.label;
    const statusChanged = oldTask.status !== task.status || oldTask.completedAt !== task.completedAt;
    if (Number(labelChanged) + Number(statusChanged) !== 1) {
      throw new MutationDerivationError("House-Task-Änderung enthält mehr als eine Operation.");
    }
    const base = mutationBase(previous, task.updatedAt);
    if (labelChanged) {
      return {
        ...base,
        type: "house.rename",
        payload: {
          taskId: task.id,
          label: task.label,
          expectedUpdatedAt: oldTask.updatedAt,
        },
      };
    }
    return {
      ...base,
      type: "house.set-status",
      payload: {
        taskId: task.id,
        status: task.status,
        completedAt: task.completedAt,
        expectedUpdatedAt: oldTask.updatedAt,
      },
    };
  }

  if (houses.removed.length === 1 && collectionDeltaCount === 1) {
    const task = houses.removed[0];
    return {
      ...mutationBase(previous, next.campaign.updatedAt),
      type: "house.delete",
      payload: { taskId: task.id, expectedUpdatedAt: task.updatedAt },
    };
  }

  if (collectionDeltaCount === 0) return null;
  throw new MutationDerivationError("Snapshot-Änderung kann nicht eindeutig als M5-Mutation abgebildet werden.");
}

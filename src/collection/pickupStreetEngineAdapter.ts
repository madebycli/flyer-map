import type {
  DistributionTask,
  LineStringGeometry,
  PolygonGeometry,
  TaskSourceProvenance,
} from "../domain/campaign.ts";
import { lineStringIsFullyInsideOrOnPolygon } from "../domain/areaTaskPreparation.ts";
import {
  MAX_NETWORK_POINTS,
  joinNetworkRoutes,
  networkSelectionState,
  resolveNetworkIntent,
  type NetworkIntent,
} from "../domain/networkSelection.ts";
import type {
  CollectionRoadSection,
  CollectionRoadSectionStatus,
  PickupSmartMarkingContext,
  PickupSmartMarkingPoint,
} from "../domain/collection.ts";
import type { NetworkRoute, RoadRange, RoadSnap } from "../domain/streetNetwork.ts";

export type PickupStreetEngineLeg = {
  routes: NetworkRoute[];
  selected: number | null;
};

export type PickupStreetEngineSelection = {
  campaignId: string;
  areaId: string;
  sectionId: string;
  label: string;
  points: RoadSnap[];
  /** Distribution Area used only as StreetEngine provenance, never as Pickup identity. */
  distributionAreaId?: string;
  pickupAreaGeometry?: PolygonGeometry;
  legs: PickupStreetEngineLeg[];
  status?: CollectionRoadSectionStatus;
  createdAt?: string;
  intentId?: string;
  idempotencyKey?: string;
};

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function selectedRoutes(selection: PickupStreetEngineSelection) {
  if (selection.points.length < 2 || selection.points.length > MAX_NETWORK_POINTS) {
    throw new Error("pickup_smart_marking_point_budget");
  }
  if (selection.legs.length !== selection.points.length - 1) {
    throw new Error("pickup_smart_marking_leg_mismatch");
  }
  const distributionAreaIds = unique(selection.points.map((point) => point.task.areaId));
  if (distributionAreaIds.length !== 1 || (selection.distributionAreaId && selection.distributionAreaId !== distributionAreaIds[0])) {
    throw new Error("pickup_smart_marking_distribution_area_mismatch");
  }
  const routes = selection.legs.map((leg) => {
    if (!Number.isInteger(leg.selected) || leg.selected === null || !leg.routes[leg.selected]) {
      throw new Error("pickup_smart_marking_route_required");
    }
    return leg.routes[leg.selected];
  });
  const route = joinNetworkRoutes(routes);
  if (!route) throw new Error("pickup_smart_marking_route_required");
  return { routes, route };
}

function smartPoint(snap: RoadSnap): PickupSmartMarkingPoint {
  return {
    point: snap.point,
    taskId: snap.task.id,
    measure: snap.measure,
    distanceMeters: snap.distance,
  };
}

function generationFor(points: RoadSnap[]) {
  const generations = unique(points.map((point) => point.task.areaPreparationGeneration ?? ""));
  if (generations.length !== 1 || !generations[0]) {
    throw new Error("pickup_smart_marking_generation_required");
  }
  return generations[0];
}

function sourceFor(tasks: DistributionTask[], ranges: RoadRange[]): TaskSourceProvenance | null {
  const selected = unique(ranges.map((range) => range.taskId))
    .map((taskId) => tasks.find((task) => task.id === taskId));
  if (!selected.length || selected.some((task) => !task?.source)) return null;
  const sources = selected.map((task) => task!.source!);
  if (sources.some((source) => source.dataset !== "OpenStreetMap" || source.objectType !== "way")) return null;
  return {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: unique(sources.flatMap((source) => source.objectIds)).sort((a, b) => a - b),
  };
}

function sameGeometry(a: LineStringGeometry, b: LineStringGeometry) {
  return a.coordinates.length === b.coordinates.length && a.coordinates.every((coordinate, index) => {
    const other = b.coordinates[index];
    return Math.abs(coordinate[0] - other[0]) <= 1e-7 && Math.abs(coordinate[1] - other[1]) <= 1e-7;
  });
}

function contextIntent(context: PickupSmartMarkingContext): NetworkIntent {
  return {
    id: context.intentId,
    areaId: "pickup",
    generation: context.generation,
    start: { point: context.start.point, taskId: context.start.taskId },
    end: { point: context.end.point, taskId: context.end.taskId },
    via: context.via.map((point) => ({ point: point.point, taskId: point.taskId })),
    selectedPath: context.selectedPath,
    paths: context.paths,
    expectedState: context.expectedState,
    status: "open",
  };
}

/**
 * Copies only the reviewed, public StreetEngine result into the independent
 * Pickup section domain. It never changes Distribution tasks or coverage.
 */
export async function createPickupRoadSectionFromSelection(
  selection: PickupStreetEngineSelection,
  tasks: DistributionTask[],
): Promise<CollectionRoadSection> {
  if (!selection.campaignId || !selection.areaId || !selection.sectionId || !selection.label.trim()) {
    throw new Error("pickup_smart_marking_metadata_required");
  }
  const generation = generationFor(selection.points);
  const { routes, route } = selectedRoutes(selection);
  const rangeTaskIds = unique(route.ranges.map((range) => range.taskId));
  const distributionAreaId = selection.points[0].task.areaId;
  if (rangeTaskIds.some((taskId) => !tasks.some((task) => task.id === taskId && task.areaId === distributionAreaId))) {
    throw new Error("pickup_smart_marking_task_missing");
  }
  const expectedState = await networkSelectionState(tasks, route.ranges);
  if (selection.pickupAreaGeometry && !lineStringIsFullyInsideOrOnPolygon(route.geometry, selection.pickupAreaGeometry)) {
    throw new Error("pickup_section_outside_area");
  }
  const points = selection.points.map(smartPoint);
  const paths = routes.map((leg) => leg.ranges.map((range) => range.taskId));
  const context: PickupSmartMarkingContext = {
    version: 1,
    intentId: selection.intentId ?? `pickup_intent_${crypto.randomUUID()}`,
    generation,
    start: points[0],
    end: points.at(-1)!,
    via: points.slice(1, -1),
    selectedPath: paths.flat(),
    paths,
    expectedState,
    idempotencyKey: selection.idempotencyKey ?? `pickup_marking_${crypto.randomUUID()}`,
    mutationIds: [],
  };
  const createdAt = selection.createdAt ?? new Date().toISOString();
  return {
    id: selection.sectionId,
    campaignId: selection.campaignId,
    areaId: selection.areaId,
    label: selection.label.trim(),
    geometry: route.geometry,
    status: selection.status ?? "open",
    coverage: [],
    sourceTaskId: rangeTaskIds.length === 1 ? rangeTaskIds[0] : null,
    sourceGeneration: generation,
    source: sourceFor(tasks, route.ranges),
    smartMarking: context,
    createdAt,
    updatedAt: createdAt,
  };
}

/** Convert the reviewed section into the existing durable mutation contract. */
export function pickupRoadSectionCreateMutation(section: CollectionRoadSection) {
  if (section.status !== "open" || section.coverage.length > 0) {
    throw new Error("pickup_section_must_start_open");
  }
  return {
    id: `mutation_${crypto.randomUUID()}`,
    campaignId: section.campaignId,
    type: "collection.pickup-section.create" as const,
    baseRevision: 0,
    createdAt: section.createdAt,
    payload: {
      sectionId: section.id,
      areaId: section.areaId,
      label: section.label,
      geometry: section.geometry,
      sourceTaskId: section.sourceTaskId,
      sourceGeneration: section.sourceGeneration,
      source: section.source,
      smartMarking: section.smartMarking,
    },
  };
}

/**
 * Revalidates a stored pickup section against the current distribution graph.
 * The check is read-only and is intentionally separate from pickup progress.
 */
export async function verifyPickupRoadSectionAgainstDistribution(
  section: CollectionRoadSection,
  tasks: DistributionTask[],
) {
  const context = section.smartMarking;
  if (!context) return { valid: true, reason: null as string | null };
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const selectedTasks = unique(context.selectedPath).map((taskId) => taskById.get(taskId));
  const selectedAreaIds = unique(selectedTasks.filter(Boolean).map((task) => task!.areaId));
  if (selectedTasks.some((task) => !task) || selectedAreaIds.length !== 1) {
    return { valid: false, reason: "pickup_smart_marking_task_missing" };
  }
  if (selectedTasks.some((task) => (task!.areaPreparationGeneration ?? "") !== context.generation)) {
    return { valid: false, reason: "pickup_smart_marking_generation_changed" };
  }
  const intent = contextIntent(context);
  intent.areaId = section.areaId;
  try {
    const route = resolveNetworkIntent(tasks, intent);
    const expectedState = await networkSelectionState(tasks, route.ranges);
    if (expectedState !== context.expectedState) return { valid: false, reason: "pickup_smart_marking_state_changed" };
    if (!sameGeometry(route.geometry, section.geometry)) {
      return { valid: false, reason: "pickup_smart_marking_geometry_changed" };
    }
    return { valid: true, reason: null as string | null };
  } catch {
    return { valid: false, reason: "pickup_smart_marking_route_changed" };
  }
}

export function pickupSectionPathTaskIds(section: CollectionRoadSection) {
  return section.smartMarking?.selectedPath ?? [];
}

export function pickupSectionPreviewGeometry(section: CollectionRoadSection): LineStringGeometry {
  return section.geometry;
}

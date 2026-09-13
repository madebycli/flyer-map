import type { DistributionTask, LineStringGeometry, PolygonGeometry, TaskSourceProvenance } from "../src/domain/campaign.ts";
import { lineStringIsFullyInsideOrOnPolygon } from "../src/domain/areaTaskPreparation.ts";
import type { CollectionRoadSection, PickupSmartMarkingContext } from "../src/domain/collection.ts";
import {
  networkSelectionState,
  resolveNetworkIntent,
  type NetworkIntent,
} from "../src/domain/networkSelection.ts";
import { RoadIndex, snapNetworkPoint, type RoadRange } from "../src/domain/streetNetwork.ts";

type SectionPayload = Pick<
  CollectionRoadSection,
  "areaId" | "geometry" | "sourceTaskId" | "sourceGeneration" | "source" | "smartMarking"
>;

export type PickupSectionValidationResult =
  | { valid: true }
  | { valid: false; code: string; message: string };

function sameGeometry(a: LineStringGeometry, b: LineStringGeometry) {
  return a.coordinates.length === b.coordinates.length && a.coordinates.every((coordinate, index) => {
    const other = b.coordinates[index];
    return Math.abs(coordinate[0] - other[0]) <= 1e-7 && Math.abs(coordinate[1] - other[1]) <= 1e-7;
  });
}

function sameSource(a: TaskSourceProvenance | null, b: TaskSourceProvenance | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sourceFor(tasks: DistributionTask[], ranges: RoadRange[]): TaskSourceProvenance | null {
  const selectedIds = [...new Set(ranges.map((range) => range.taskId))];
  const selected = selectedIds.map((taskId) => tasks.find((task) => task.id === taskId));
  if (!selected.length || selected.some((task) => !task?.source)) return null;
  const sources = selected.map((task) => task!.source!);
  if (sources.some((source) => source.dataset !== "OpenStreetMap" || source.objectType !== "way")) {
    return null;
  }
  return {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [...new Set(sources.flatMap((source) => source.objectIds))].sort((a, b) => a - b),
  };
}

function intentFor(areaId: string, context: PickupSmartMarkingContext): NetworkIntent {
  return {
    id: context.intentId,
    areaId,
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
 * The browser may prepare a Pickup preview, but the current StreetEngine graph
 * remains authoritative. Recompute the route and expected state before D1
 * accepts a Pickup section, so a stale or forged geometry cannot be persisted.
 */
export async function validatePickupSectionAgainstDistribution(
  tasks: DistributionTask[],
  payload: SectionPayload,
  pickupAreaGeometry: PolygonGeometry | null = null,
): Promise<PickupSectionValidationResult> {
  if (!pickupAreaGeometry || !lineStringIsFullyInsideOrOnPolygon(payload.geometry, pickupAreaGeometry)) {
    return {
      valid: false,
      code: "pickup_section_outside_area",
      message: "Die Pickup-Straße muss vollständig innerhalb der Pickup Area liegen.",
    };
  }
  const context = payload.smartMarking;
  if (!context) {
    if (payload.sourceTaskId !== null || payload.sourceGeneration !== null || payload.source !== null) {
      return {
        valid: false,
        code: "pickup_section_provenance_invalid",
        message: "Manuelle Pickup-Abschnitte dürfen keine ungeprüfte StreetEngine-Provenance tragen.",
      };
    }
    return { valid: true };
  }

  // Collection Areas and Distribution Areas are deliberately separate
  // identities. The selected task IDs determine the StreetEngine graph; the
  // payload areaId remains the Pickup ownership context.
  const areaTasks = tasks.filter((task) => task.network);
  const selectedTaskIds = [...new Set(context.selectedPath)];
  const selectedTasks = selectedTaskIds.map((taskId) => areaTasks.find((task) => task.id === taskId));
  if (!selectedTasks.length || selectedTasks.some((task) => !task)) {
    return {
      valid: false,
      code: "pickup_smart_marking_task_missing",
      message: "Der Pickup-Abschnitt verweist auf keine aktuelle vorbereitete Straße.",
    };
  }
  if (selectedTasks.some((task) => (task!.areaPreparationGeneration ?? "") !== context.generation)) {
    return {
      valid: false,
      code: "pickup_smart_marking_generation_changed",
      message: "Die StreetEngine-Generation des Pickup-Abschnitts ist nicht mehr aktuell.",
    };
  }
  const distributionAreaIds = new Set(selectedTasks.map((task) => task!.areaId));
  if (distributionAreaIds.size !== 1) {
    return {
      valid: false,
      code: "pickup_smart_marking_distribution_area_mismatch",
      message: "Ein Pickup-Abschnitt darf nicht über mehrere Distribution Areas führen.",
    };
  }

  const index = new RoadIndex(areaTasks);
  const points = [context.start, ...context.via, context.end];
  try {
    for (const point of points) {
      const snap = snapNetworkPoint(index, point.point, point.taskId);
      if (Math.abs(snap.measure - point.measure) > 0.25 || Math.abs(snap.distance - point.distanceMeters) > 0.25) {
        return {
          valid: false,
          code: "pickup_smart_marking_point_changed",
          message: "Ein Pickup-Wegpunkt passt nicht mehr zur vorbereiteten Straße.",
        };
      }
    }

    const route = resolveNetworkIntent(areaTasks, intentFor(payload.areaId, context));
    const expectedState = await networkSelectionState(areaTasks, route.ranges);
    if (expectedState !== context.expectedState) {
      return {
        valid: false,
        code: "pickup_smart_marking_state_changed",
        message: "Der Pickup-Abschnitt basiert auf einem veralteten StreetEngine- oder Coverage-Stand.",
      };
    }
    if (!sameGeometry(route.geometry, payload.geometry)) {
      return {
        valid: false,
        code: "pickup_smart_marking_geometry_changed",
        message: "Die gespeicherte Pickup-Geometrie entspricht nicht der geprüften Route.",
      };
    }

    const routeTaskIds = [...new Set(route.ranges.map((range) => range.taskId))];
    const expectedSourceTaskId = routeTaskIds.length === 1 ? routeTaskIds[0] : null;
    if (payload.sourceTaskId !== expectedSourceTaskId || payload.sourceGeneration !== context.generation) {
      return {
        valid: false,
        code: "pickup_section_provenance_invalid",
        message: "Die Pickup-Provenance entspricht nicht der geprüften Route.",
      };
    }
    if (!sameSource(payload.source, sourceFor(areaTasks, route.ranges))) {
      return {
        valid: false,
        code: "pickup_section_provenance_invalid",
        message: "Die OSM-Provenance des Pickup-Abschnitts konnte nicht bestätigt werden.",
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      code: "pickup_smart_marking_route_changed",
      message: "Die geprüfte Pickup-Route ist im aktuellen StreetEngine-Netz nicht mehr vorhanden.",
    };
  }
}

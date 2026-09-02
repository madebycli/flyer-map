import type { DistributionTask } from "./campaign.ts";
import type { SmartRoadCandidate } from "./smartCandidates.ts";

function preparedOsmWayId(task: DistributionTask) {
  if (!task.areaPreparationGeneration) return null;
  const source = task.source;
  if (!source || source.dataset !== "OpenStreetMap" || source.objectType !== "way") return null;
  if (source.objectIds.length !== 1) return null;
  const osmId = source.objectIds[0];
  return Number.isSafeInteger(osmId) && osmId > 0 ? osmId : null;
}

/**
 * Server-prepared Street Tasks double as the durable candidate geometry for Smart Street.
 * The Task id is deliberately the candidate source id so concave Area fragments from the
 * same OSM way remain independently selectable, while OSM ids stay provenance only.
 */
export function preparedSmartRoadCandidates(
  tasks: readonly DistributionTask[],
  areaId: string,
): SmartRoadCandidate[] {
  return tasks.flatMap((task) => {
    if (task.areaId !== areaId) return [];
    const osmId = preparedOsmWayId(task);
    if (osmId === null) return [];
    return [{
      sourceId: `prepared:${task.id}`,
      osmId,
      name: task.label.trim() || null,
      ref: null,
      highway: "prepared",
      geometry: {
        type: "LineString",
        coordinates: task.geometry.coordinates.map(([lng, lat]) => [lng, lat]),
      },
    }];
  });
}

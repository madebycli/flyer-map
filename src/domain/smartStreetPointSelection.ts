import type { RoadSnap } from './streetNetwork.ts';

export const SMART_POINT_FALLBACK_RADIUS_METERS = 20;
export const SMART_POINT_AMBIGUITY_METERS = 3;

/**
 * Preserve pointer intent before route optimization.
 *
 * Rendered street ids, when present, are the strongest signal because they
 * represent the line(s) actually under the pointer. Without rendered ids we
 * fall back to a bounded spatial search. In both cases only candidates nearly
 * as close as the best spatial snap may compete on route length. This keeps
 * crossings routable without allowing a farther parallel/adjacent street to
 * win only because it produces a shorter network route.
 */
export function smartPointCandidates(
  candidates: readonly RoadSnap[],
  sourceIds: readonly string[],
): RoadSnap[] {
  const sourceSet = sourceIds.length > 0 ? new Set(sourceIds) : null;
  const eligible = candidates
    .filter((candidate) => sourceSet ? sourceSet.has(candidate.task.id) : candidate.distance <= SMART_POINT_FALLBACK_RADIUS_METERS)
    .sort((left, right) => left.distance - right.distance || left.task.id.localeCompare(right.task.id));

  if (eligible.length === 0) return [];
  const nearestDistance = eligible[0].distance;
  return eligible.filter((candidate) => candidate.distance <= nearestDistance + SMART_POINT_AMBIGUITY_METERS);
}

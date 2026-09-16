import type { DistributionTask, HouseTask } from './campaign.ts';

export type StreetScreeningMode = 'classic' | 'delivery-v2';

export type StreetScreeningReason =
  | 'classic'
  | 'manual_or_legacy'
  | 'serves_houses'
  | 'named_or_referenced'
  | 'unnamed_without_houses';

export type StreetScreeningDecision = {
  taskId: string;
  visible: boolean;
  reason: StreetScreeningReason;
  houseCount: number;
};

export type StreetScreeningResult = {
  tasks: DistributionTask[];
  decisions: StreetScreeningDecision[];
  hiddenTaskIds: string[];
};

function normalizedLabel(label: string) {
  return label.normalize('NFKC').toLocaleLowerCase('de').replace(/[\s.]+/g, ' ').trim();
}

function isGenericUnnamedLabel(label: string) {
  return ['straße', 'strasse', 'street'].includes(normalizedLabel(label));
}

/**
 * Conservative post-generation beta screening.
 *
 * V2 intentionally keeps the canonical StreetEngine graph untouched. It only
 * changes which prepared streets are rendered in the normal distribution view.
 * Hidden streets therefore remain available for Smart Marking and routing.
 *
 * Without persisted OSM delivery-relevance metadata we only hide one class:
 * auto-prepared, generic unnamed streets with zero assigned House tasks. Named
 * streets, manual/legacy streets and every street serving a House remain visible.
 */
export function screenDistributionStreets(
  tasks: DistributionTask[],
  houses: HouseTask[],
  mode: StreetScreeningMode,
): StreetScreeningResult {
  const houseCountByStreet = new Map<string, number>();
  for (const house of houses) {
    if (!house.parentStreetTaskId) continue;
    houseCountByStreet.set(
      house.parentStreetTaskId,
      (houseCountByStreet.get(house.parentStreetTaskId) ?? 0) + 1,
    );
  }

  const decisions = tasks.map((task): StreetScreeningDecision => {
    const houseCount = houseCountByStreet.get(task.id) ?? 0;
    if (mode === 'classic') {
      return { taskId: task.id, visible: true, reason: 'classic', houseCount };
    }
    if (!task.network || !task.areaPreparationGeneration) {
      return { taskId: task.id, visible: true, reason: 'manual_or_legacy', houseCount };
    }
    if (houseCount > 0) {
      return { taskId: task.id, visible: true, reason: 'serves_houses', houseCount };
    }
    if (!isGenericUnnamedLabel(task.label)) {
      return { taskId: task.id, visible: true, reason: 'named_or_referenced', houseCount };
    }
    return { taskId: task.id, visible: false, reason: 'unnamed_without_houses', houseCount };
  });

  const hidden = new Set(decisions.filter((decision) => !decision.visible).map((decision) => decision.taskId));
  return {
    tasks: tasks.filter((task) => !hidden.has(task.id)),
    decisions,
    hiddenTaskIds: [...hidden],
  };
}

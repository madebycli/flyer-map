import type {
  AdminAnalyticsExportInput,
  AnalyticsStatusCounts,
} from "./adminAnalyticsExport.ts";

export type ActionComparisonSummary = {
  actionName: string;
  generatedAt: string;
  distribution: AnalyticsStatusCounts;
  pickupTotal: number;
  pickupCollected: number;
  sessionCount: number;
  personMinutes: number;
};

export type ActionComparisonDelta = {
  fromAction: string;
  toAction: string;
  completedDelta: number;
  openDelta: number;
  notDeliverableDelta: number;
  pickupCollectedDelta: number;
  sessionCountDelta: number;
  personMinutesDelta: number;
};

function addCounts(target: AnalyticsStatusCounts, source: AnalyticsStatusCounts) {
  target.total += source.total;
  target.completed += source.completed;
  target.open += source.open;
  target.later += source.later;
  target.notDeliverable += source.notDeliverable;
}

export function summarizeActionForComparison(
  input: AdminAnalyticsExportInput,
): ActionComparisonSummary {
  const distribution: AnalyticsStatusCounts = {
    total: 0,
    completed: 0,
    open: 0,
    later: 0,
    notDeliverable: 0,
  };

  let pickupTotal = 0;
  let pickupCollected = 0;
  let sessionCount = 0;
  let personMinutes = 0;

  for (const team of input.teams) {
    addCounts(distribution, team.distribution);
    pickupTotal += team.pickupTotal;
    pickupCollected += team.pickupCollected;
    sessionCount += team.sessionCount;
    personMinutes += team.personMinutes;
  }

  return {
    actionName: input.actionName,
    generatedAt: input.generatedAt,
    distribution,
    pickupTotal,
    pickupCollected,
    sessionCount,
    personMinutes,
  };
}

/**
 * Compare actions in caller-provided chronological order. Deltas are descriptive,
 * not a performance score: a bigger/changed territory may legitimately change
 * workload between rounds.
 */
export function compareActionSeries(
  actions: AdminAnalyticsExportInput[],
): { summaries: ActionComparisonSummary[]; deltas: ActionComparisonDelta[] } {
  const summaries = actions.map(summarizeActionForComparison);
  const deltas: ActionComparisonDelta[] = [];

  for (let index = 1; index < summaries.length; index += 1) {
    const previous = summaries[index - 1];
    const current = summaries[index];
    deltas.push({
      fromAction: previous.actionName,
      toAction: current.actionName,
      completedDelta: current.distribution.completed - previous.distribution.completed,
      openDelta: current.distribution.open - previous.distribution.open,
      notDeliverableDelta:
        current.distribution.notDeliverable - previous.distribution.notDeliverable,
      pickupCollectedDelta: current.pickupCollected - previous.pickupCollected,
      sessionCountDelta: current.sessionCount - previous.sessionCount,
      personMinutesDelta: current.personMinutes - previous.personMinutes,
    });
  }

  return { summaries, deltas };
}

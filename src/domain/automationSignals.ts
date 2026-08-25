export type ProgressThresholdSignal = {
  type: "progress-threshold";
  threshold: number;
  previousPercent: number | null;
  currentPercent: number;
};

export type ManualSyncActionState = "conflict" | "blocked-auth" | "invalid" | "retry" | "saved";

export type ManualSyncActionSignal = {
  type: "manual-sync-action";
  state: "conflict" | "blocked-auth" | "invalid";
};

const DEFAULT_THRESHOLDS = [25, 50, 75, 100] as const;

function normalizedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function crossedProgressThresholds(
  previousPercent: number | null,
  currentPercent: number | null,
  thresholds: readonly number[] = DEFAULT_THRESHOLDS,
): ProgressThresholdSignal[] {
  const previous = normalizedPercent(previousPercent);
  const current = normalizedPercent(currentPercent);
  if (current === null || (previous !== null && current <= previous)) return [];

  const uniqueThresholds = [...new Set(thresholds)]
    .filter((threshold) => Number.isFinite(threshold) && threshold > 0 && threshold <= 100)
    .sort((a, b) => a - b);

  return uniqueThresholds
    .filter((threshold) => (previous === null ? current >= threshold : previous < threshold && current >= threshold))
    .map((threshold) => ({
      type: "progress-threshold" as const,
      threshold,
      previousPercent: previous,
      currentPercent: current,
    }));
}

export function manualSyncActionRequired(
  state: ManualSyncActionState,
): ManualSyncActionSignal | null {
  if (state === "conflict" || state === "blocked-auth" || state === "invalid") {
    return { type: "manual-sync-action", state };
  }
  return null;
}

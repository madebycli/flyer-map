export type FieldSessionMetricInput = {
  startedAt: string;
  endedAt: string;
  participantCount: number;
  affectedTaskIds?: string[];
};

export type FieldSessionMetrics = {
  durationMinutes: number;
  participantCount: number;
  personMinutes: number;
  affectedTaskCount: number;
};

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function calculateFieldSessionMetrics(
  input: FieldSessionMetricInput,
): FieldSessionMetrics | null {
  const startedAt = parseTimestamp(input.startedAt);
  const endedAt = parseTimestamp(input.endedAt);
  if (startedAt === null || endedAt === null || endedAt < startedAt) return null;
  if (
    !Number.isSafeInteger(input.participantCount) ||
    input.participantCount < 1 ||
    input.participantCount > 500
  ) {
    return null;
  }

  const durationMinutes = (endedAt - startedAt) / 60_000;
  if (!Number.isFinite(durationMinutes) || durationMinutes > 24 * 60) return null;

  const affectedTaskCount = new Set(
    (input.affectedTaskIds ?? []).filter(
      (taskId) => taskId.length > 0 && taskId.length <= 180 && /^[A-Za-z0-9._:-]+$/u.test(taskId),
    ),
  ).size;

  return {
    durationMinutes,
    participantCount: input.participantCount,
    personMinutes: durationMinutes * input.participantCount,
    affectedTaskCount,
  };
}

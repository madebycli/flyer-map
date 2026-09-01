import {
  calculateFieldSessionMetrics,
  type FieldSessionMetrics,
} from "./fieldSessionMetrics.ts";

export const LIVE_GROUP_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type LiveGroupTourMode = "distribution" | "collection";
export type LiveGroupTourState = "active" | "closed" | "expired";

export type LiveGroupTour = {
  groupId: string;
  mode: LiveGroupTourMode;
  createdAt: string;
  hardExpiresAt: string;
  state: LiveGroupTourState;
  participantCount: number | null;
  endedAt: string | null;
};

export type LiveGroupFieldSessionSummary = {
  mode: LiveGroupTourMode;
  startedAt: string;
  endedAt: string;
  participantCount: number;
  metrics: FieldSessionMetrics;
};

export type LiveGroupParticipantUpdateResult =
  | { ok: true; tour: LiveGroupTour }
  | { ok: false; reason: "invalid-participants" | "not-active"; tour: LiveGroupTour };

export type LiveGroupCloseResult =
  | {
      ok: true;
      tour: LiveGroupTour & {
        state: "closed";
        participantCount: number;
        endedAt: string;
      };
      session: LiveGroupFieldSessionSummary;
    }
  | {
      ok: false;
      reason: "final-participants-required" | "invalid-time" | "not-active";
      tour: LiveGroupTour;
    };

function parseTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function validParticipantCount(value: number) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 500;
}

function hardExpiryFromCreatedAt(createdAt: string) {
  const createdTimestamp = parseTimestamp(createdAt);
  if (createdTimestamp === null) {
    throw new Error("invalid_live_group_lifecycle_time");
  }
  return new Date(createdTimestamp + LIVE_GROUP_MAX_LIFETIME_MS).toISOString();
}

export function createLiveGroupTour(input: {
  groupId: string;
  mode: LiveGroupTourMode;
  createdAt: string;
  participantCount?: number | null;
}): LiveGroupTour {
  const createdAt = parseTimestamp(input.createdAt);
  if (createdAt === null) {
    throw new Error("invalid_live_group_created_at");
  }
  if (!input.groupId || input.groupId.length > 180 || !/^[A-Za-z0-9._:-]+$/u.test(input.groupId)) {
    throw new Error("invalid_live_group_id");
  }
  if (input.participantCount != null && !validParticipantCount(input.participantCount)) {
    throw new Error("invalid_live_group_participants");
  }

  const normalizedCreatedAt = new Date(createdAt).toISOString();
  return {
    groupId: input.groupId,
    mode: input.mode,
    createdAt: normalizedCreatedAt,
    hardExpiresAt: hardExpiryFromCreatedAt(normalizedCreatedAt),
    state: "active",
    participantCount: input.participantCount ?? null,
    endedAt: null,
  };
}

export function resolveLiveGroupTour(tour: LiveGroupTour, now: string): LiveGroupTour {
  if (tour.state !== "active") return tour;

  const nowTimestamp = parseTimestamp(now);
  if (nowTimestamp === null) {
    throw new Error("invalid_live_group_lifecycle_time");
  }

  const hardExpiresAt = hardExpiryFromCreatedAt(tour.createdAt);
  const expiresTimestamp = Date.parse(hardExpiresAt);
  const normalizedTour =
    tour.hardExpiresAt === hardExpiresAt ? tour : { ...tour, hardExpiresAt };

  if (nowTimestamp < expiresTimestamp) return normalizedTour;

  return {
    ...normalizedTour,
    state: "expired",
    endedAt: hardExpiresAt,
  };
}

export function updateLiveGroupParticipantCount(
  tour: LiveGroupTour,
  participantCount: number,
  now: string,
): LiveGroupParticipantUpdateResult {
  const effectiveTour = resolveLiveGroupTour(tour, now);
  if (effectiveTour.state !== "active") {
    return { ok: false, reason: "not-active", tour: effectiveTour };
  }
  if (!validParticipantCount(participantCount)) {
    return { ok: false, reason: "invalid-participants", tour: effectiveTour };
  }

  return {
    ok: true,
    tour: {
      ...effectiveTour,
      participantCount,
    },
  };
}

export function closeLiveGroupTour(
  tour: LiveGroupTour,
  endedAt: string,
): LiveGroupCloseResult {
  const effectiveTour = resolveLiveGroupTour(tour, endedAt);
  if (effectiveTour.state !== "active") {
    return { ok: false, reason: "not-active", tour: effectiveTour };
  }
  if (effectiveTour.participantCount === null) {
    return { ok: false, reason: "final-participants-required", tour: effectiveTour };
  }

  const metrics = calculateFieldSessionMetrics({
    startedAt: effectiveTour.createdAt,
    endedAt,
    participantCount: effectiveTour.participantCount,
  });
  if (!metrics) {
    return { ok: false, reason: "invalid-time", tour: effectiveTour };
  }

  const normalizedEndedAt = new Date(Date.parse(endedAt)).toISOString();
  return {
    ok: true,
    tour: {
      ...effectiveTour,
      state: "closed",
      endedAt: normalizedEndedAt,
      participantCount: effectiveTour.participantCount,
    },
    session: {
      mode: effectiveTour.mode,
      startedAt: effectiveTour.createdAt,
      endedAt: normalizedEndedAt,
      participantCount: effectiveTour.participantCount,
      metrics,
    },
  };
}

export type PickupStatus = "open" | "collected" | "unavailable" | "needs-follow-up";

export type PickupDraft = {
  address: string;
  note: string;
  sourceBuildingId: string | null;
};

export type PickupDraftValidation =
  | { valid: true; value: PickupDraft }
  | { valid: false; reason: "address-required" | "address-too-long" | "note-too-long" | "source-id-invalid" };

export type PickupProgressSummary = {
  denominator: "pickup-tasks";
  total: number;
  collected: number;
  open: number;
  unavailable: number;
  needsFollowUp: number;
  remaining: number;
  percentCollected: number | null;
};

function normalizeText(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function validSourceBuildingId(value: string | null) {
  return value === null || /^way\/\d+$/u.test(value);
}

export function validatePickupDraft(input: PickupDraft): PickupDraftValidation {
  const address = normalizeText(input.address);
  const note = input.note.trim();
  if (!address) return { valid: false, reason: "address-required" };
  if (address.length > 240) return { valid: false, reason: "address-too-long" };
  if (note.length > 2_000) return { valid: false, reason: "note-too-long" };
  if (!validSourceBuildingId(input.sourceBuildingId)) {
    return { valid: false, reason: "source-id-invalid" };
  }
  return {
    valid: true,
    value: {
      address,
      note,
      sourceBuildingId: input.sourceBuildingId,
    },
  };
}

export function summarizePickupStatuses(statuses: PickupStatus[]): PickupProgressSummary {
  const collected = statuses.filter((status) => status === "collected").length;
  const open = statuses.filter((status) => status === "open").length;
  const unavailable = statuses.filter((status) => status === "unavailable").length;
  const needsFollowUp = statuses.filter((status) => status === "needs-follow-up").length;
  const total = statuses.length;
  return {
    denominator: "pickup-tasks",
    total,
    collected,
    open,
    unavailable,
    needsFollowUp,
    remaining: total - collected,
    percentCollected: total === 0 ? null : (collected / total) * 100,
  };
}

export function pickupStatusTransition(
  current: PickupStatus,
  next: PickupStatus,
) {
  if (current === next) return current;
  return next;
}

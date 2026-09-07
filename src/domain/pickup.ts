import type { LngLat } from "./campaign";

export type PickupStatus = "open" | "collected" | "unavailable" | "needs-follow-up";

export type PickupSource =
  | {
      kind: "osm-address";
      provider: string;
      placeId: string | null;
      osmType: string | null;
      osmId: string | null;
    }
  | {
      kind: "distribution-house";
      taskId: string;
    };

export type PickupActor = {
  kind: "campaign-grant" | "collection-collector";
  ref: string | null;
};

export type PickupTask = {
  id: string;
  campaignId: string;
  areaId: string | null;
  title: string;
  address: string;
  description: string;
  position: LngLat;
  status: PickupStatus;
  archivedAt: string | null;
  assignedRunIds: string[];
  assignedCollectorIds: string[];
  source: PickupSource | null;
  createdBy: PickupActor;
  updatedBy: PickupActor;
  createdAt: string;
  updatedAt: string;
};

export type PickupDraft = {
  title: string;
  address: string;
  description: string;
  position: LngLat | null;
  areaId: string | null;
  source: PickupSource | null;
};

export type PickupDraftValidation =
  | { valid: true; value: PickupDraft & { position: LngLat } }
  | {
      valid: false;
      reason:
        | "title-required"
        | "title-too-long"
        | "address-required"
        | "address-too-long"
        | "description-too-long"
        | "position-required"
        | "position-invalid"
        | "area-id-invalid"
        | "source-invalid";
    };

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

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  return value.trim().replace(/\s+/gu, " ");
}

function validIdentifier(value: unknown) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 200 &&
    /^[A-Za-z0-9._:-]+$/u.test(value)
  );
}

function validOptionalSourceValue(value: unknown) {
  return value === null || (typeof value === "string" && value.length <= 240);
}

export function isPickupPosition(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1]) &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

export function isPickupSource(value: unknown): value is PickupSource | null {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.kind === "distribution-house") {
    return (
      typeof source.taskId === "string" &&
      /^task_[A-Za-z0-9._:-]+$/u.test(source.taskId) &&
      Object.keys(source).length === 2
    );
  }
  if (source.kind !== "osm-address" || !validIdentifier(source.provider)) return false;
  return (
    validOptionalSourceValue(source.placeId) &&
    validOptionalSourceValue(source.osmType) &&
    validOptionalSourceValue(source.osmId) &&
    Object.keys(source).sort().join(",") === "kind,osmId,osmType,placeId,provider"
  );
}

export function validatePickupDraft(input: PickupDraft): PickupDraftValidation {
  const title = normalizeText(input?.title);
  const address = normalizeText(input?.address);
  const description = typeof input?.description === "string" ? input.description.trim() : "";
  const position = input?.position ?? null;
  const areaId = input?.areaId ?? null;
  const source = input?.source ?? null;

  if (!title) return { valid: false, reason: "title-required" };
  if (title.length > 160) return { valid: false, reason: "title-too-long" };
  if (!address) return { valid: false, reason: "address-required" };
  if (address.length > 320) return { valid: false, reason: "address-too-long" };
  if (description.length > 4_000) return { valid: false, reason: "description-too-long" };
  if (position === null) return { valid: false, reason: "position-required" };
  if (!isPickupPosition(position)) return { valid: false, reason: "position-invalid" };
  if (areaId !== null && !validIdentifier(areaId)) return { valid: false, reason: "area-id-invalid" };
  if (!isPickupSource(source)) return { valid: false, reason: "source-invalid" };
  return {
    valid: true,
    value: {
      title,
      address,
      description,
      position,
      areaId,
      source,
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

export function pickupStatusTransition(current: PickupStatus, next: PickupStatus) {
  if (current === next) return current;
  return next;
}

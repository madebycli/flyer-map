import type {
  Area,
  Campaign,
  CampaignSnapshot,
  DistributionTask,
  LineStringGeometry,
  LngLat,
  MapCameraView,
  PolygonGeometry,
  TaskSourceProvenance,
  Team,
} from "../src/domain/campaign.ts";
import {
  validateLineStringVertices,
  validatePolygonVertices,
} from "../src/domain/geometry.ts";

export type SnapshotValidationResult =
  | { valid: true; snapshot: CampaignSnapshot }
  | { valid: false; message: string };

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function isLngLat(value: unknown): value is LngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isMapRange([lng, lat]: LngLat) {
  return lng >= -180 && lng <= 180 && lat >= -85.0511 && lat <= 85.0511;
}

function parseMapCameraView(value: unknown): MapCameraView | null {
  if (!isRecord(value) || !isLngLat(value.center) || !isMapRange(value.center)) return null;
  if (typeof value.zoom !== "number" || !Number.isFinite(value.zoom) || value.zoom < 0 || value.zoom > 20) {
    return null;
  }
  if (
    typeof value.bearing !== "number" ||
    !Number.isFinite(value.bearing) ||
    value.bearing < -360 ||
    value.bearing > 360
  ) {
    return null;
  }
  return value as MapCameraView;
}

function samePoint(a: LngLat, b: LngLat) {
  return a[0] === b[0] && a[1] === b[1];
}

function parsePolygonGeometry(value: unknown): PolygonGeometry | null {
  if (!isRecord(value) || value.type !== "Polygon" || !Array.isArray(value.coordinates)) {
    return null;
  }

  if (value.coordinates.length !== 1) return null;
  const ring = value.coordinates[0];
  if (!Array.isArray(ring) || !ring.every(isLngLat) || ring.length < 4) return null;
  if (!samePoint(ring[0], ring[ring.length - 1])) return null;

  const vertices = ring.slice(0, -1);
  const validation = validatePolygonVertices(vertices);
  if (!validation.valid) return null;

  return value as PolygonGeometry;
}

function parseLineStringGeometry(value: unknown): LineStringGeometry | null {
  if (
    !isRecord(value) ||
    value.type !== "LineString" ||
    !Array.isArray(value.coordinates) ||
    !value.coordinates.every(isLngLat)
  ) {
    return null;
  }

  const validation = validateLineStringVertices(value.coordinates);
  if (!validation.valid) return null;

  return value as LineStringGeometry;
}

function parseTaskSource(value: unknown): TaskSourceProvenance | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "dataset,objectIds,objectType") return null;
  if (value.dataset !== "OpenStreetMap" || value.objectType !== "way") return null;
  if (
    !Array.isArray(value.objectIds)
    || value.objectIds.length === 0
    || !value.objectIds.every(
      (objectId) => typeof objectId === "number" && Number.isSafeInteger(objectId) && objectId > 0,
    )
  ) {
    return null;
  }
  return value as TaskSourceProvenance;
}

function parseCampaign(value: unknown, campaignId: string): Campaign | null {
  if (!isRecord(value)) return null;
  if (value.id !== campaignId) return null;
  if (!isBoundedString(value.name, 160)) return null;
  if (value.status !== "draft" && value.status !== "active" && value.status !== "archived") {
    return null;
  }
  if (value.defaultMapView !== null && !parseMapCameraView(value.defaultMapView)) return null;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null;

  return value as Campaign;
}

function parseTeam(value: unknown, campaignId: string): Team | null {
  if (!isRecord(value)) return null;
  if (!isId(value.id) || value.campaignId !== campaignId) return null;
  if (!isBoundedString(value.name, 120)) return null;
  if (typeof value.color !== "string" || !HEX_COLOR_PATTERN.test(value.color)) return null;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null;

  return value as Team;
}

function parseArea(value: unknown, campaignId: string): Area | null {
  if (!isRecord(value)) return null;
  if (!isId(value.id) || value.campaignId !== campaignId || !isId(value.teamId)) return null;
  if (!isBoundedString(value.name, 160)) return null;
  if (!parsePolygonGeometry(value.geometry)) return null;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null;

  return value as Area;
}

function parseTask(value: unknown, campaignId: string): DistributionTask | null {
  if (!isRecord(value)) return null;
  if (!isId(value.id) || value.campaignId !== campaignId || !isId(value.areaId)) return null;
  if (value.taskType !== "street") return null;
  if (!isBoundedString(value.label, 160)) return null;
  if (!parseLineStringGeometry(value.geometry)) return null;
  if (value.source !== undefined && value.source !== null && !parseTaskSource(value.source)) return null;
  if (
    value.status !== "open" &&
    value.status !== "completed" &&
    value.status !== "later" &&
    value.status !== "not-deliverable"
  ) {
    return null;
  }

  if (value.status === "completed") {
    if (!isTimestamp(value.completedAt)) return null;
  } else if (value.completedAt !== null) {
    return null;
  }

  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null;

  return value as DistributionTask;
}

function hasUniqueIds<T extends { id: string }>(values: T[]) {
  return new Set(values.map((value) => value.id)).size === values.length;
}

export function validateCampaignSnapshot(
  value: unknown,
  campaignId: string,
): SnapshotValidationResult {
  if (!isId(campaignId)) {
    return { valid: false, message: "Ungültige Campaign-ID." };
  }

  if (!isRecord(value) || value.schemaVersion !== 3) {
    return { valid: false, message: "Snapshot-Schema wird nicht unterstützt." };
  }

  if (
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  ) {
    return { valid: false, message: "Snapshot-Revision ist ungültig." };
  }

  const campaign = parseCampaign(value.campaign, campaignId);
  if (!campaign) {
    return {
      valid: false,
      message: "Campaign-Daten sind ungültig oder gehören zu einer anderen Campaign.",
    };
  }

  if (!Array.isArray(value.teams) || !Array.isArray(value.areas) || !Array.isArray(value.tasks)) {
    return { valid: false, message: "Snapshot-Collections sind ungültig." };
  }

  const teams: Team[] = [];
  for (const candidate of value.teams) {
    const team = parseTeam(candidate, campaignId);
    if (!team) return { valid: false, message: "Mindestens ein Team ist ungültig." };
    teams.push(team);
  }

  const areas: Area[] = [];
  for (const candidate of value.areas) {
    const area = parseArea(candidate, campaignId);
    if (!area) {
      return { valid: false, message: "Mindestens ein Gebiet oder Polygon ist ungültig." };
    }
    areas.push(area);
  }

  const tasks: DistributionTask[] = [];
  for (const candidate of value.tasks) {
    const task = parseTask(candidate, campaignId);
    if (!task) {
      return {
        valid: false,
        message: "Mindestens eine Straße, Geometrie, Provenance oder ein Status ist ungültig.",
      };
    }
    tasks.push(task);
  }

  if (!hasUniqueIds(teams) || !hasUniqueIds(areas) || !hasUniqueIds(tasks)) {
    return { valid: false, message: "Entity-IDs müssen innerhalb des Snapshots eindeutig sein." };
  }

  const teamIds = new Set(teams.map((team) => team.id));
  const teamColors = new Set<string>();
  for (const team of teams) {
    const normalizedColor = team.color.toLowerCase();
    if (teamColors.has(normalizedColor)) {
      return {
        valid: false,
        message: "Teamfarben müssen innerhalb einer Campaign eindeutig sein.",
      };
    }
    teamColors.add(normalizedColor);
  }

  for (const area of areas) {
    if (!teamIds.has(area.teamId)) {
      return {
        valid: false,
        message: "Ein Gebiet verweist auf ein fremdes oder fehlendes Team.",
      };
    }
  }

  const areaIds = new Set(areas.map((area) => area.id));
  for (const task of tasks) {
    if (!areaIds.has(task.areaId)) {
      return {
        valid: false,
        message: "Eine Straße verweist auf ein fremdes oder fehlendes Gebiet.",
      };
    }
  }

  return {
    valid: true,
    snapshot: {
      schemaVersion: 3,
      revision: value.revision,
      campaign,
      teams,
      areas,
      tasks,
    },
  };
}

export function parseCampaignId(value: string) {
  return ID_PATTERN.test(value) ? value : null;
}

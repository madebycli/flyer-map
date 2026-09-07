import type { CollectionSnapshot } from "./collection";

export type LngLat = [number, number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: LngLat[][];
};

export type LineStringGeometry = {
  type: "LineString";
  coordinates: LngLat[];
};

export type TaskSourceProvenance = {
  dataset: "OpenStreetMap";
  objectType: "way";
  objectIds: number[];
};

export type MapCameraView = {
  center: LngLat;
  zoom: number;
  bearing: number;
};

export type CampaignStatus = "draft" | "active" | "archived";
export type TaskStatus = "open" | "completed" | "later" | "not-deliverable";

export type Campaign = {
  id: string;
  name: string;
  status: CampaignStatus;
  defaultMapView: MapCameraView | null;
  createdAt: string;
  updatedAt: string;
};

export type Team = {
  id: string;
  campaignId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type Area = {
  id: string;
  campaignId: string;
  teamId: string;
  name: string;
  geometry: PolygonGeometry;
  createdAt: string;
  updatedAt: string;
};

export type DistributionTask = {
  id: string;
  campaignId: string;
  areaId: string;
  taskType: "street";
  label: string;
  geometry: LineStringGeometry;
  /**
   * Optional for backwards-compatible schema-v3 caches and manual Street Tasks.
   * Smart Streets persist reviewed external provenance here, never as Task identity.
   */
  source?: TaskSourceProvenance | null;
  /**
   * Null (and missing legacy snapshots) means a normal/manual task. A non-null
   * value is assigned exclusively by the server-side Area preparation job.
   */
  areaPreparationGeneration?: string | null;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HouseTask = {
  id: string;
  campaignId: string;
  areaId: string;
  taskType: "house";
  label: string;
  geometry: PolygonGeometry;
  /** Optional reviewed source provenance. OSM ids never become House Task identity. */
  source?: TaskSourceProvenance | null;
  /** See DistributionTask.areaPreparationGeneration. */
  areaPreparationGeneration?: string | null;
  /** Optional relationship to a Street Task in the same Campaign and Area. */
  parentStreetTaskId: string | null;
  status: TaskStatus;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignSnapshot = {
  schemaVersion: 3;
  revision: number;
  campaign: Campaign;
  teams: Team[];
  areas: Area[];
  tasks: DistributionTask[];
  /**
   * M6 House Tasks are an additive schema-v3 extension. Older snapshots omit the
   * collection and are interpreted as having no House Tasks.
   */
  houseTasks?: HouseTask[];
  /** First-class Collection state is independent from Distribution. */
  collection?: CollectionSnapshot;
};

/**
 * Keeps schema-v3 snapshots from before automatic Area preparation additive.
 * The wire field is optional for backwards compatibility, while application
 * state uses an explicit null for every non-automatic Task.
 */
export function normalizeAreaPreparationGenerations(snapshot: CampaignSnapshot): CampaignSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => ({
      ...task,
      areaPreparationGeneration: task.areaPreparationGeneration ?? null,
    })),
    ...(snapshot.houseTasks
      ? {
          houseTasks: snapshot.houseTasks.map((task) => ({
            ...task,
            areaPreparationGeneration: task.areaPreparationGeneration ?? null,
          })),
        }
      : {}),
  };
}

export type TeamColor = {
  value: string;
  label: string;
};

export const TEAM_COLORS: readonly TeamColor[] = [
  { value: "#ea580c", label: "Orange" },
  { value: "#2563eb", label: "Blau" },
  { value: "#15803d", label: "Grün" },
  { value: "#be123c", label: "Rot" },
  { value: "#64748b", label: "Grau" },
  { value: "#7e22ce", label: "Violett" },
  { value: "#0f766e", label: "Türkis" },
  { value: "#b45309", label: "Gold" },
  { value: "#4338ca", label: "Indigo" },
  { value: "#0369a1", label: "Petrolblau" },
  { value: "#a21caf", label: "Magenta" },
  { value: "#4d7c0f", label: "Olivgrün" },
  { value: "#b91c1c", label: "Karminrot" },
  { value: "#0e7490", label: "Seegrün" },
  { value: "#6d28d9", label: "Lila" },
] as const;

export const TASK_STATUS_OPTIONS: readonly { value: TaskStatus; label: string }[] = [
  { value: "open", label: "Offen" },
  { value: "completed", label: "Erledigt" },
  { value: "later", label: "Später" },
  { value: "not-deliverable", label: "Nicht zustellbar" },
] as const;

export const createId = (prefix: "campaign" | "team" | "area" | "task") =>
  `${prefix}_${crypto.randomUUID()}`;

export function createInitialSnapshot(): CampaignSnapshot {
  const now = new Date().toISOString();
  const campaignId = createId("campaign");

  return {
    schemaVersion: 3,
    revision: 0,
    campaign: {
      id: campaignId,
      name: "Neue Verteilaktion",
      status: "active",
      defaultMapView: null,
      createdAt: now,
      updatedAt: now,
    },
    teams: [],
    areas: [],
    tasks: [],
  };
}

export function nextAvailableTeamColor(teams: Team[]) {
  const used = new Set(teams.map((team) => team.color.toLowerCase()));
  const preset = TEAM_COLORS.find((color) => !used.has(color.value.toLowerCase()))?.value;
  if (preset) return preset;
  for (let index = 0; index < 360; index += 1) {
    const hue = (teams.length * 47 + index * 137) % 360;
    const chroma = 62;
    const light = 38;
    const candidate = hslToHex(hue, chroma, light);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return "#334155";
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (offset: number) => (offset + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(offset) - 3, 9 - k(offset), 1))));
  return `#${[channel(0), channel(8), channel(4)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function openPolygonRing(geometry: PolygonGeometry): LngLat[] {
  const ring = geometry.coordinates[0] ?? [];
  if (ring.length < 2) return ring.map(([lng, lat]) => [lng, lat]);

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  const points = isClosed ? ring.slice(0, -1) : ring;

  return points.map(([lng, lat]) => [lng, lat]);
}

export function createPolygonGeometry(vertices: LngLat[]): PolygonGeometry {
  const ring = vertices.map(([lng, lat]) => [lng, lat] as LngLat);
  if (ring.length > 0) {
    ring.push([ring[0][0], ring[0][1]]);
  }

  return {
    type: "Polygon",
    coordinates: [ring],
  };
}

export function createLineStringGeometry(vertices: LngLat[]): LineStringGeometry {
  return {
    type: "LineString",
    coordinates: vertices.map(([lng, lat]) => [lng, lat]),
  };
}

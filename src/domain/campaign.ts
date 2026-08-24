export type LngLat = [number, number];

export type PolygonGeometry = {
  type: "Polygon";
  coordinates: LngLat[][];
};

export type LineStringGeometry = {
  type: "LineString";
  coordinates: LngLat[];
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
};

export type TeamColor = {
  value: string;
  label: string;
};

export const TEAM_COLORS: readonly TeamColor[] = [
  { value: "#2563eb", label: "Blau" },
  { value: "#ea580c", label: "Orange" },
  { value: "#15803d", label: "Grün" },
  { value: "#7e22ce", label: "Violett" },
  { value: "#be123c", label: "Rot" },
  { value: "#0f766e", label: "Türkis" },
  { value: "#b45309", label: "Gold" },
  { value: "#4338ca", label: "Indigo" },
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
  return TEAM_COLORS.find((color) => !used.has(color.value.toLowerCase()))?.value ?? null;
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

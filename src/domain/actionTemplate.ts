import type {
  CampaignSnapshot,
  LineStringGeometry,
  MapCameraView,
  PolygonGeometry,
} from "./campaign.ts";

export type ActionMode = "distribution" | "collection";

export type ActionTemplateTeam = {
  key: string;
  name: string;
  color: string;
};

export type ActionTemplateArea = {
  key: string;
  teamKey: string;
  name: string;
  geometry: PolygonGeometry;
};

export type ActionTemplateRoadSection = {
  key: string;
  areaKey: string;
  label: string;
  geometry: LineStringGeometry;
};

export type ActionTemplateOperationalDefaults = {
  fieldGroupDiscoverableByDefault: boolean;
};

export type ActionTemplateBlueprint = {
  schemaVersion: 2;
  mode: ActionMode;
  name: string;
  defaultMapView: MapCameraView | null;
  operationalDefaults: ActionTemplateOperationalDefaults;
  teams: ActionTemplateTeam[];
  areas: ActionTemplateArea[];
  roadSections: ActionTemplateRoadSection[];
};

export type ActionRunDraft = {
  templateName: string;
  mode: ActionMode;
  defaultMapView: MapCameraView | null;
  operationalDefaults: ActionTemplateOperationalDefaults;
  teams: ActionTemplateTeam[];
  areas: ActionTemplateArea[];
  distributionTasks: Array<ActionTemplateRoadSection & { status: "open" }>;
  collectionRoadSections: Array<ActionTemplateRoadSection & { status: "open" }>;
  pickupTasks: [];
};

export type ActionTemplateFile = {
  format: "flyer-map-action-template";
  fileVersion: 1;
  template: ActionTemplateBlueprint;
};

const MAX_TEMPLATE_BYTES = 2_000_000;

function clonePolygon(geometry: PolygonGeometry): PolygonGeometry {
  return {
    type: "Polygon",
    coordinates: geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lng, lat])),
  };
}

function cloneLineString(geometry: LineStringGeometry): LineStringGeometry {
  return {
    type: "LineString",
    coordinates: geometry.coordinates.map(([lng, lat]) => [lng, lat]),
  };
}

function cloneMapView(view: MapCameraView | null): MapCameraView | null {
  return view
    ? {
        center: [view.center[0], view.center[1]],
        zoom: view.zoom,
        bearing: view.bearing,
      }
    : null;
}

function validText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validCoordinate(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function validPolygon(value: unknown): value is PolygonGeometry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as PolygonGeometry;
  return (
    candidate.type === "Polygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(
      (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(validCoordinate),
    )
  );
}

function validLineString(value: unknown): value is LineStringGeometry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as LineStringGeometry;
  return (
    candidate.type === "LineString" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length >= 2 &&
    candidate.coordinates.every(validCoordinate)
  );
}

function validMapView(value: unknown): value is MapCameraView | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const candidate = value as MapCameraView;
  return (
    validCoordinate(candidate.center) &&
    Number.isFinite(candidate.zoom) &&
    candidate.zoom >= 0 &&
    candidate.zoom <= 24 &&
    Number.isFinite(candidate.bearing) &&
    candidate.bearing >= -360 &&
    candidate.bearing <= 360
  );
}

function cloneTemplate(template: ActionTemplateBlueprint): ActionTemplateBlueprint {
  return {
    schemaVersion: 2,
    mode: template.mode,
    name: template.name,
    defaultMapView: cloneMapView(template.defaultMapView),
    operationalDefaults: { ...template.operationalDefaults },
    teams: template.teams.map((team) => ({ ...team })),
    areas: template.areas.map((area) => ({ ...area, geometry: clonePolygon(area.geometry) })),
    roadSections: template.roadSections.map((section) => ({
      ...section,
      geometry: cloneLineString(section.geometry),
    })),
  };
}

export function validateActionTemplate(template: unknown): template is ActionTemplateBlueprint {
  if (!template || typeof template !== "object") return false;
  const candidate = template as ActionTemplateBlueprint;
  if (candidate.schemaVersion !== 2) return false;
  if (candidate.mode !== "distribution" && candidate.mode !== "collection") return false;
  if (!validText(candidate.name, 160) || !validMapView(candidate.defaultMapView)) return false;
  if (
    !candidate.operationalDefaults ||
    typeof candidate.operationalDefaults.fieldGroupDiscoverableByDefault !== "boolean"
  ) {
    return false;
  }
  if (!Array.isArray(candidate.teams) || !Array.isArray(candidate.areas) || !Array.isArray(candidate.roadSections)) {
    return false;
  }

  const teamKeys = new Set<string>();
  for (const team of candidate.teams) {
    if (!validText(team?.key, 120) || !validText(team?.name, 160) || !validText(team?.color, 32)) return false;
    if (teamKeys.has(team.key)) return false;
    teamKeys.add(team.key);
  }

  const areaKeys = new Set<string>();
  for (const area of candidate.areas) {
    if (!validText(area?.key, 120) || !validText(area?.teamKey, 120) || !validText(area?.name, 160)) return false;
    if (!teamKeys.has(area.teamKey) || areaKeys.has(area.key) || !validPolygon(area.geometry)) return false;
    areaKeys.add(area.key);
  }

  const sectionKeys = new Set<string>();
  for (const section of candidate.roadSections) {
    if (!validText(section?.key, 120) || !validText(section?.areaKey, 120) || !validText(section?.label, 240)) return false;
    if (!areaKeys.has(section.areaKey) || sectionKeys.has(section.key) || !validLineString(section.geometry)) return false;
    sectionKeys.add(section.key);
  }

  return true;
}

export function actionTemplateFromCampaign(
  snapshot: CampaignSnapshot,
  templateName: string,
): ActionTemplateBlueprint {
  const normalizedName = templateName.trim();
  if (!normalizedName || normalizedName.length > 160) throw new Error("invalid_template_name");

  const teamKeyById = new Map<string, string>();
  const teams = snapshot.teams.map((team, index) => {
    const key = `team-${index + 1}`;
    teamKeyById.set(team.id, key);
    return { key, name: team.name, color: team.color };
  });

  const areaKeyById = new Map<string, string>();
  const areas = snapshot.areas.flatMap((area, index) => {
    const teamKey = teamKeyById.get(area.teamId);
    if (!teamKey) return [];
    const key = `area-${index + 1}`;
    areaKeyById.set(area.id, key);
    return [{ key, teamKey, name: area.name, geometry: clonePolygon(area.geometry) }];
  });

  const roadSections = snapshot.tasks.flatMap((task, index) => {
    const areaKey = areaKeyById.get(task.areaId);
    if (!areaKey) return [];
    return [{
      key: `road-${index + 1}`,
      areaKey,
      label: task.label,
      geometry: cloneLineString(task.geometry),
    }];
  });

  return {
    schemaVersion: 2,
    mode: "distribution",
    name: normalizedName,
    defaultMapView: cloneMapView(snapshot.campaign.defaultMapView),
    operationalDefaults: { fieldGroupDiscoverableByDefault: true },
    teams,
    areas,
    roadSections,
  };
}

export function createCollectionActionTemplate(
  template: Omit<ActionTemplateBlueprint, "schemaVersion" | "mode">,
): ActionTemplateBlueprint {
  const candidate: ActionTemplateBlueprint = {
    ...template,
    schemaVersion: 2,
    mode: "collection",
  };
  if (!validateActionTemplate(candidate)) throw new Error("invalid_collection_template");
  return cloneTemplate(candidate);
}

export function actionRunDraftFromTemplate(template: ActionTemplateBlueprint): ActionRunDraft {
  if (!validateActionTemplate(template)) throw new Error("invalid_action_template");

  const roadSections = template.roadSections.map((section) => ({
    ...section,
    geometry: cloneLineString(section.geometry),
  }));

  return {
    templateName: template.name,
    mode: template.mode,
    defaultMapView: cloneMapView(template.defaultMapView),
    operationalDefaults: { ...template.operationalDefaults },
    teams: template.teams.map((team) => ({ ...team })),
    areas: template.areas.map((area) => ({ ...area, geometry: clonePolygon(area.geometry) })),
    distributionTasks:
      template.mode === "distribution"
        ? roadSections.map((section) => ({ ...section, status: "open" as const }))
        : [],
    collectionRoadSections:
      template.mode === "collection"
        ? roadSections.map((section) => ({ ...section, status: "open" as const }))
        : [],
    pickupTasks: [],
  };
}

export function serializeActionTemplate(template: ActionTemplateBlueprint) {
  if (!validateActionTemplate(template)) throw new Error("invalid_action_template");
  const file: ActionTemplateFile = {
    format: "flyer-map-action-template",
    fileVersion: 1,
    template: cloneTemplate(template),
  };
  return JSON.stringify(file, null, 2);
}

export function parseActionTemplateFile(text: string): ActionTemplateBlueprint {
  if (new TextEncoder().encode(text).byteLength > MAX_TEMPLATE_BYTES) {
    throw new Error("template_file_too_large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_template_file");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("invalid_template_file");
  const file = parsed as ActionTemplateFile;
  if (file.format !== "flyer-map-action-template" || file.fileVersion !== 1) {
    throw new Error("unsupported_template_file");
  }
  if (!validateActionTemplate(file.template)) throw new Error("invalid_template_file");
  return cloneTemplate(file.template);
}

export function actionTemplateFilename(template: ActionTemplateBlueprint) {
  const safeName = template.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "aktionsvorlage";
  return `${safeName}.flyer-map-template.json`;
}

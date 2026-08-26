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

export type ActionTemplateStreetSection = {
  key: string;
  areaKey: string;
  label: string;
  geometry: LineStringGeometry;
};

export type ActionTemplateBlueprint = {
  schemaVersion: 1;
  name: string;
  defaultMapView: MapCameraView | null;
  teams: ActionTemplateTeam[];
  areas: ActionTemplateArea[];
  streetSections: ActionTemplateStreetSection[];
};

export type ActionRunDraft = {
  templateName: string;
  mode: ActionMode;
  defaultMapView: MapCameraView | null;
  teams: ActionTemplateTeam[];
  areas: ActionTemplateArea[];
  distributionTasks: Array<ActionTemplateStreetSection & { status: "open" }>;
  collectionReferenceSections: ActionTemplateStreetSection[];
  pickupTasks: [];
};

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

/**
 * Extract reusable planning structure from one finished/current Campaign snapshot.
 * Operational ids, completion state, timestamps and history are intentionally not
 * copied into the template.
 */
export function actionTemplateFromCampaign(
  snapshot: CampaignSnapshot,
  templateName: string,
): ActionTemplateBlueprint {
  const normalizedName = templateName.trim();
  if (!normalizedName || normalizedName.length > 160) {
    throw new Error("invalid_template_name");
  }

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
    return [
      {
        key,
        teamKey,
        name: area.name,
        geometry: clonePolygon(area.geometry),
      },
    ];
  });

  const streetSections = snapshot.tasks.flatMap((task, index) => {
    const areaKey = areaKeyById.get(task.areaId);
    if (!areaKey) return [];
    return [
      {
        key: `street-${index + 1}`,
        areaKey,
        label: task.label,
        geometry: cloneLineString(task.geometry),
      },
    ];
  });

  return {
    schemaVersion: 1,
    name: normalizedName,
    defaultMapView: cloneMapView(snapshot.campaign.defaultMapView),
    teams,
    areas,
    streetSections,
  };
}

/**
 * Create a clean per-action draft. Distribution reuses the planned street
 * sections as fresh open work. Collection reuses planning context only; pickup
 * addresses/tasks start empty and are created from actual collection reports.
 */
export function actionRunDraftFromTemplate(
  template: ActionTemplateBlueprint,
  mode: ActionMode,
): ActionRunDraft {
  const streetSections = template.streetSections.map((section) => ({
    ...section,
    geometry: cloneLineString(section.geometry),
  }));

  return {
    templateName: template.name,
    mode,
    defaultMapView: cloneMapView(template.defaultMapView),
    teams: template.teams.map((team) => ({ ...team })),
    areas: template.areas.map((area) => ({
      ...area,
      geometry: clonePolygon(area.geometry),
    })),
    distributionTasks:
      mode === "distribution"
        ? streetSections.map((section) => ({ ...section, status: "open" as const }))
        : [],
    collectionReferenceSections: mode === "collection" ? streetSections : [],
    pickupTasks: [],
  };
}

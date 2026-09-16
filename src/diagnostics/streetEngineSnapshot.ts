const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{32,}/g;
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|secret|token)/iu;

export type DiagnosticAreaSummary = {
  id: string;
  name: string;
  teamId: string | null;
  updatedAt: string | null;
  polygonVertices: number | null;
  bbox: [number, number, number, number] | null;
  streetTasks: number;
  preparedStreetTasks: number;
  houseTasks: number;
};

export type CampaignDiagnosticData = {
  storageState: "ok" | "missing" | "invalid";
  campaignId: string | null;
  revision: number | null;
  totals: {
    areas: number;
    streetTasks: number;
    preparedStreetTasks: number;
    houseTasks: number;
  };
  duplicateAreaNames: Array<{ name: string; areaIds: string[] }>;
  areas: DiagnosticAreaSummary[];
};

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function polygonSummary(geometry: unknown) {
  if (!isRecord(geometry) || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    return { polygonVertices: null, bbox: null as [number, number, number, number] | null };
  }
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring)) {
    return { polygonVertices: null, bbox: null as [number, number, number, number] | null };
  }

  const points = ring.flatMap((candidate) => {
    if (!Array.isArray(candidate) || candidate.length < 2) return [];
    const lng = numberValue(candidate[0]);
    const lat = numberValue(candidate[1]);
    return lng === null || lat === null ? [] : [[lng, lat] as [number, number]];
  });
  if (!points.length) return { polygonVertices: 0, bbox: null as [number, number, number, number] | null };

  const first = points[0];
  const last = points.at(-1)!;
  const closed = points.length > 1 && first[0] === last[0] && first[1] === last[1];
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return {
    polygonVertices: points.length - (closed ? 1 : 0),
    bbox: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [number, number, number, number],
  };
}

export function readCampaignDiagnosticData(raw: string | null): CampaignDiagnosticData {
  const empty = (storageState: CampaignDiagnosticData["storageState"]): CampaignDiagnosticData => ({
    storageState,
    campaignId: null,
    revision: null,
    totals: { areas: 0, streetTasks: 0, preparedStreetTasks: 0, houseTasks: 0 },
    duplicateAreaNames: [],
    areas: [],
  });
  if (!raw) return empty("missing");

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return empty("invalid");
    const campaign = isRecord(parsed.campaign) ? parsed.campaign : null;
    const areas = Array.isArray(parsed.areas) ? parsed.areas.filter(isRecord) : [];
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(isRecord) : [];
    const houseTasks = Array.isArray(parsed.houseTasks) ? parsed.houseTasks.filter(isRecord) : [];

    const areaSummaries = areas.map((area, index) => {
      const id = stringValue(area.id) ?? `unknown-area-${index + 1}`;
      const geometry = polygonSummary(area.geometry);
      const areaTasks = tasks.filter((task) => task.areaId === id);
      return {
        id,
        name: stringValue(area.name)?.trim() || "(ohne Namen)",
        teamId: stringValue(area.teamId),
        updatedAt: stringValue(area.updatedAt),
        ...geometry,
        streetTasks: areaTasks.length,
        preparedStreetTasks: areaTasks.filter((task) => Boolean(task.areaPreparationGeneration || task.network)).length,
        houseTasks: houseTasks.filter((task) => task.areaId === id).length,
      } satisfies DiagnosticAreaSummary;
    });

    const names = new Map<string, DiagnosticAreaSummary[]>();
    for (const area of areaSummaries) {
      const key = area.name.trim().toLocaleLowerCase();
      names.set(key, [...(names.get(key) ?? []), area]);
    }
    const duplicateAreaNames = [...names.values()]
      .filter((group) => group.length > 1)
      .map((group) => ({ name: group[0].name, areaIds: group.map((area) => area.id) }));

    const preparedStreetTasks = tasks.filter((task) => Boolean(task.areaPreparationGeneration || task.network)).length;
    return {
      storageState: "ok",
      campaignId: stringValue(campaign?.id),
      revision: numberValue(parsed.revision),
      totals: {
        areas: areaSummaries.length,
        streetTasks: tasks.length,
        preparedStreetTasks,
        houseTasks: houseTasks.length,
      },
      duplicateAreaNames,
      areas: areaSummaries,
    };
  } catch {
    return empty("invalid");
  }
}

export function safeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth-limit]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.replace(TOKEN_LIKE_PATTERN, "[redacted]").slice(0, 1_000);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => safeDiagnosticValue(item, depth + 1));
  if (!isRecord(value)) return String(value).slice(0, 200);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .slice(0, 60)
      .map(([key, nested]) => [key, safeDiagnosticValue(nested, depth + 1)]),
  );
}

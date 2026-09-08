import type { Area } from "../src/domain/campaign.ts";
import type { AccessContext } from "./access.ts";
import { hasStreetNetworkSchema, loadCampaignSnapshot, type D1DatabaseLike } from "./campaignRepository.ts";
import {
  beginAreaTaskPreparation,
  runAreaTaskPreparation,
  shouldStartAreaPreparation,
  type AreaPreparationExecutionContext,
  type AreaTaskPreparationOptions,
} from "./areaTaskPreparation.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

type PreparationRoute = { campaignId: string; areaId: string };

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

const error = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, { status });

export function areaTaskPreparationRoute(pathname: string): PreparationRoute | null {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/areas\/([^/]+)\/preparation$/u);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const areaId = decodeURIComponent(match[2]);
    if (!campaignId || !/^[A-Za-z0-9._:-]{1,160}$/u.test(areaId)) return null;
    return { campaignId, areaId };
  } catch {
    return null;
  }
}

function canReadArea(access: AccessContext, area: Area) {
  if (access.role === "admin" || access.role === "viewer") return true;
  return (access.role === "team-editor" || access.role === "field-group-member") && access.teamId === area.teamId;
}

function canStartAreaPreparation(access: AccessContext, area: Area) {
  return access.role === "admin" || (access.role === "team-editor" && access.teamId === area.teamId);
}

async function hasPreparationPayload(request: Request): Promise<boolean> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 0) return true;
  if (!request.body) return false;
  // An incoming empty POST can have a stream. Reject actual bytes, not the
  // transport representation, and never buffer client geometry or OSM queries.
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength > 0) return true;
    }
  } catch {
    return true;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function handleAreaTaskPreparationApi(
  request: Request,
  db: D1DatabaseLike,
  route: PreparationRoute,
  access: AccessContext,
  context: AreaPreparationExecutionContext | undefined,
  options?: AreaTaskPreparationOptions,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return error(405, "method_not_allowed", "Für die Area-Vorbereitung ist nur GET oder POST erlaubt.");
  }
  if (access.campaignId !== route.campaignId) {
    return error(403, "forbidden", "Der Zugriff gehört zu einer anderen Campaign.");
  }
  const snapshot = await loadCampaignSnapshot(db, route.campaignId);
  if (!snapshot) return error(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  const area = snapshot.areas.find((candidate) => candidate.id === route.areaId);
  if (!area) return error(404, "area_not_found", "Area wurde nicht gefunden.");
  if (!canReadArea(access, area)) {
    return error(403, "forbidden", "Diese Area liegt außerhalb deines Zugriffs.");
  }
  if (request.method === "POST" && await hasPreparationPayload(request)) {
    return error(
      400,
      "invalid_request",
      "Die Area-Vorbereitung akzeptiert keine clientseitige Geometry, BBox oder Query.",
    );
  }

  const decision = await shouldStartAreaPreparation(db, route.campaignId, area);
  if (!decision.schemaAvailable || !await hasStreetNetworkSchema(db)) {
    return error(
      503,
      "area_preparation_schema_unavailable",
      "Die Migrationen für die Straßen- und Hausvorbereitung sind serverseitig noch nicht verfügbar.",
    );
  }
  if (request.method === "GET") return json(decision.state);
  if (!canStartAreaPreparation(access, area)) {
    return error(403, "forbidden", "Nur Admin oder der zuständige Team Editor darf vorbereiten.");
  }
  if (!decision.shouldStart && decision.state.status !== "pending") {
    return json(decision.state, { status: decision.state.status === "ready" ? 200 : 202 });
  }

  const leased = await db.prepare('SELECT lease_until FROM street_network_jobs WHERE campaign_id=? AND area_id=? AND lease IS NOT NULL AND lease_until>?').bind(route.campaignId,route.areaId,(options?.now?.()??new Date()).toISOString()).first();
  if (leased) return json(decision.state,{status:202});

  const preparation = await beginAreaTaskPreparation(db, route.campaignId, route.areaId, options);
  if (preparation.outcome === "run") {
    const job = runAreaTaskPreparation(db, preparation.run, options);
    if (context) context.waitUntil(job);
    else await job;
  } else if (
    preparation.result.outcome === "failed" &&
    preparation.result.code === "area_preparation_schema_unavailable"
  ) {
    return error(
      503,
      "area_preparation_schema_unavailable",
      "Die Migrationen für die Straßen- und Hausvorbereitung sind serverseitig noch nicht verfügbar.",
    );
  } else if (preparation.result.outcome === "missing") {
    return error(404, "area_not_found", "Area wurde nicht gefunden.");
  } else if (preparation.result.outcome !== "stale") {
    const current = await shouldStartAreaPreparation(db, route.campaignId, area);
    return json(
      current.state,
      { status: current.state.status === "ready" ? 200 : 202 },
    );
  }
  return json(
    {
      status: "pending",
      roadCount: 0,
      houseCount: 0,
      sourceTimestamp: null,
      errorCode: null,
      updatedAt: new Date().toISOString(),
    },
    { status: 202 },
  );
}

import baseWorker, { legacySnapshotWriteResponse } from "./index.ts";
import { resolveAccess } from "./access.ts";
import {
  loadCampaignSnapshot,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import {
  handleFieldGroupApi,
  parseFieldGroupRoute,
  type FieldGroupEnv,
} from "./fieldGroups.ts";
import { handleFieldGroupMembersApi } from "./fieldGroupMembers.ts";
import { hasFieldSessionHistorySchema } from "./fieldSessionHistory.ts";
import { handleFieldSessionNoteApi } from "./fieldSessionNote.ts";
import { handleFieldSessionTasksApi } from "./fieldSessionTasks.ts";
import { handleFieldSessionsApi } from "./fieldSessions.ts";
import { handleOfflineMapPackage } from "./offlineMap.ts";
import { parseCampaignId } from "./snapshotValidation.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";

type Env = FieldGroupEnv & {
  DB?: D1DatabaseLike;
  M4_BOOTSTRAP_SECRET?: string;
  OSM_OVERPASS_URL?: string;
};

const jsonError = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

export function offlineMapCampaignRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/offline-map\/package$/);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function snapshotCampaignRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/snapshot$/u);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function accessCurrentCampaign(url: URL) {
  if (url.pathname !== "/api/access/current") return null;
  return parseCampaignId(url.searchParams.get("campaign") ?? "");
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function temporarySnapshotResponse(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
) {
  if (request.method === "PUT") return legacySnapshotWriteResponse();

  const access = await resolveAccess(db, request, campaignId);
  if (access?.role !== "field-group-member") return null;
  if (request.method !== "GET") return null;
  if (!access.teamId) {
    return jsonError(403, "field_group_scope_missing", "Temporärer Team-Scope fehlt.");
  }

  const snapshot = await loadCampaignSnapshot(db, campaignId);
  if (!snapshot) return jsonError(404, "campaign_not_found", "Campaign wurde nicht gefunden.");

  const areaIds = new Set(
    snapshot.areas.filter((area) => area.teamId === access.teamId).map((area) => area.id),
  );
  const scoped = {
    ...snapshot,
    teams: snapshot.teams.filter((team) => team.id === access.teamId),
    areas: snapshot.areas.filter((area) => areaIds.has(area.id)),
    tasks: snapshot.tasks.filter((task) => areaIds.has(task.areaId)),
    houseTasks: (snapshot.houseTasks ?? []).filter((task) => areaIds.has(task.areaId)),
  };

  return json(scoped, {
    headers: { etag: `"${campaignId}:${snapshot.revision}:team:${access.teamId}"` },
  });
}

export default {
  async fetch(request: Request, env: Env, context?: AreaPreparationExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (env.DB) {
      const sessionNoteResponse = await handleFieldSessionNoteApi(request, env.DB);
      if (sessionNoteResponse) return sessionNoteResponse;

      const sessionTasksResponse = await handleFieldSessionTasksApi(request, env.DB);
      if (sessionTasksResponse) return sessionTasksResponse;

      const sessionResponse = await handleFieldSessionsApi(request, env.DB);
      if (sessionResponse) return sessionResponse;

      const memberResponse = await handleFieldGroupMembersApi(request, env.DB);
      if (memberResponse) return memberResponse;
    }

    const fieldGroupRoute = parseFieldGroupRoute(url.pathname);
    if (
      fieldGroupRoute?.kind === "close" &&
      request.method === "POST" &&
      env.DB &&
      !(await hasFieldSessionHistorySchema(env.DB))
    ) {
      return jsonError(
        503,
        "field_session_schema_unavailable",
        "Einsatz kann erst geschlossen werden, wenn die Field-Session-Historie serverseitig verfügbar ist.",
      );
    }

    const fieldGroupResponse = await handleFieldGroupApi(request, env);
    if (fieldGroupResponse) return fieldGroupResponse;

    const currentCampaignId = accessCurrentCampaign(url);
    if (currentCampaignId && request.method === "GET" && env.DB) {
      const access = await resolveAccess(env.DB, request, currentCampaignId);
      if (access?.role === "field-group-member") {
        return json({
          access: {
            campaignId: access.campaignId,
            role: access.role,
            teamId: access.teamId,
            groupId: access.groupId ?? null,
            label: access.label,
          },
        });
      }
    }

    const snapshotCampaignId = snapshotCampaignRoute(url.pathname);
    if (snapshotCampaignId && env.DB) {
      try {
        const response = await temporarySnapshotResponse(request, env.DB, snapshotCampaignId);
        if (response) return response;
      } catch {
        return jsonError(500, "temporary_snapshot_failed", "Team-Kartendaten konnten nicht geladen werden.");
      }
    }

    const campaignId = offlineMapCampaignRoute(url.pathname);
    if (!campaignId) return baseWorker.fetch(request, env, context);

    if (request.method !== "POST") {
      return jsonError(405, "method_not_allowed", "Für diesen Endpunkt ist nur POST erlaubt.");
    }
    if (!sameOrigin(request)) {
      return jsonError(
        403,
        "origin_forbidden",
        "Cross-Origin-Schreibzugriffe sind nicht erlaubt.",
      );
    }
    if (!env.DB) {
      return jsonError(503, "d1_unavailable", "D1 ist für diesen Worker noch nicht gebunden.");
    }

    try {
      const access = await resolveAccess(env.DB, request, campaignId);
      if (!access) {
        return jsonError(
          401,
          "access_required",
          "Gültiger Campaign-Zugriff ist erforderlich.",
        );
      }
      return await handleOfflineMapPackage(request, { upstreamUrl: env.OSM_OVERPASS_URL });
    } catch {
      return jsonError(
        500,
        "offline_package_failed",
        "Offline-Kartenbereich konnte nicht erstellt werden.",
      );
    }
  },
};

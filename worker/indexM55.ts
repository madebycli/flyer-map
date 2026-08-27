import baseWorker from "./index.ts";
import { resolveAccess } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { handleFieldGroupApi, type FieldGroupEnv } from "./fieldGroups.ts";
import { handleOfflineMapPackage } from "./offlineMap.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

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

export function offlineMapCampaignRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/offline-map\/package$/);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const fieldGroupResponse = await handleFieldGroupApi(request, env);
    if (fieldGroupResponse) return fieldGroupResponse;

    const campaignId = offlineMapCampaignRoute(new URL(request.url).pathname);
    if (!campaignId) return baseWorker.fetch(request, env);

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

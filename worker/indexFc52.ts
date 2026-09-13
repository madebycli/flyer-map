import baseWorker from "./indexM55.ts";
import { resolvePersistentAccess } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { hasPickupAreaRoomSchema } from "./campaignRepository.ts";
import { resolveCollectionAccess } from "./collectionAccess.ts";
import {
  augmentPickupCapabilitiesResponse,
  handlePickupCapabilitiesApi,
  loadPickupCapabilities,
} from "./pickupCapabilities.ts";
import {
  hasPickupReadSchema,
  loadPickupTasks,
  StoredPickupError,
} from "./pickupRepository.ts";
import {
  handlePickupSearch,
  pickupSearchCampaignRoute,
  type PickupSearchEnv,
} from "./pickupSearch.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";

// Wrangler's Durable Object migration resolves the class from the module
// entrypoint, while the base Worker keeps the HTTP/auth implementation.
export { CampaignSyncDurableObject } from "./campaignSyncDurableObject.ts";

type AssetBinding = {
  fetch(request: Request): Promise<Response>;
};

type Env = Parameters<typeof baseWorker.fetch>[1] & PickupSearchEnv & {
  ASSETS?: AssetBinding;
};

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

function snapshotCampaignId(pathname: string) {
  const match = pathname.match(
    /^\/api\/campaigns\/([^/]+)\/(?:snapshot|collection\/snapshot)$/u,
  );
  if (!match) return null;
  try {
    const campaignId = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9._:-]{1,160}$/u.test(campaignId) ? campaignId : null;
  } catch {
    return null;
  }
}

function shouldServeRootAsset(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return new URL(request.url).pathname === "/";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function collectorCanViewPickups(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
) {
  const persistent = await resolvePersistentAccess(db, request, campaignId);
  if (persistent) return true;
  const collection = await resolveCollectionAccess(db, request, campaignId);
  if (collection?.role !== "collection-collector" || !collection.collectorId) return false;
  const capabilities = await loadPickupCapabilities(db, campaignId, collection.collectorId);
  return capabilities?.canViewPickups === true;
}

export async function augmentPickupSnapshotResponse(
  response: Response,
  db: D1DatabaseLike,
  campaignId: string,
  request?: Request,
) {
  if (!response.ok) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  if (!isRecord(payload) || !isRecord(payload.collection)) return response;

  if (!(await hasPickupReadSchema(db))) {
    return json(
      {
        error: {
          code: "pickup_schema_unavailable",
          message: "Pickup-Daten benötigen die vorbereitete Migration 0011.",
        },
        ...(typeof payload.revision === "number" ? { revision: payload.revision } : {}),
      },
      { status: 503 },
    );
  }

  try {
    const canView = request
      ? await collectorCanViewPickups(request, db, campaignId)
      : true;
    const pickups = canView ? await loadPickupTasks(db, campaignId) : [];
    const pickupRoomsAvailable = await hasPickupAreaRoomSchema(db);
    const collection = payload.collection as Record<string, unknown>;
    const areas = Array.isArray(collection.areas) ? collection.areas : [];
    const roadSections = Array.isArray(collection.roadSections) ? collection.roadSections : [];
    const progress = Array.isArray(collection.progress) ? collection.progress : [];
    const pickupCounts = new Map<string, { total: number; collected: number }>();
    for (const pickup of pickups) {
      if (!pickup.areaId || pickup.archivedAt !== null) continue;
      const count = pickupCounts.get(pickup.areaId) ?? { total: 0, collected: 0 };
      count.total += 1;
      if (pickup.status === "collected") count.collected += 1;
      pickupCounts.set(pickup.areaId, count);
    }
    const enrichedProgress = pickupRoomsAvailable
      ? areas.map((area) => {
          const areaId = isRecord(area) && typeof area.id === "string" ? area.id : "";
          const sections = roadSections.filter((section) => isRecord(section) && section.areaId === areaId);
          const counts = pickupCounts.get(areaId) ?? { total: 0, collected: 0 };
          const prior = progress.find((item) => isRecord(item) && item.areaId === areaId);
          return {
            ...(isRecord(prior) ? prior : {}),
            areaId,
            roadSectionsTotal: sections.length,
            roadSectionsDriven: sections.filter((section) => isRecord(section) && section.status === "driven").length,
            roadSectionsOpen: sections.filter((section) => isRecord(section) && section.status === "open").length,
            roadSectionsLater: sections.filter((section) => isRecord(section) && section.status === "later").length,
            roadSectionsUnavailable: sections.filter((section) => isRecord(section) && section.status === "unavailable").length,
            pickupsTotal: counts.total,
            pickupsCollected: counts.collected,
            updatedAt: isRecord(area) && typeof area.updatedAt === "string" ? area.updatedAt : new Date(0).toISOString(),
          };
        })
      : progress;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return Response.json(
      {
        ...payload,
        collection: {
          ...collection,
          pickups,
          ...(pickupRoomsAvailable ? { progress: enrichedProgress } : {}),
        },
      },
      {
        status: response.status,
        statusText: response.statusText,
        headers,
      },
    );
  } catch (error) {
    if (error instanceof StoredPickupError) {
      return json(
        {
          error: {
            code: "stored_pickup_invalid",
            message: error.message,
          },
          ...(typeof payload.revision === "number" ? { revision: payload.revision } : {}),
        },
        { status: 500 },
      );
    }
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env, context?: AreaPreparationExecutionContext): Promise<Response> {
    if (shouldServeRootAsset(request) && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    if (env.DB) {
      const capabilityResponse = await handlePickupCapabilitiesApi(request, env.DB);
      if (capabilityResponse) return capabilityResponse;

      const searchCampaignId = pickupSearchCampaignRoute(new URL(request.url).pathname);
      if (searchCampaignId && await hasPickupReadSchema(env.DB)) {
        const collection = await resolveCollectionAccess(env.DB, request, searchCampaignId);
        if (collection?.role === "collection-collector" && collection.collectorId) {
          const capabilities = await loadPickupCapabilities(
            env.DB,
            searchCampaignId,
            collection.collectorId,
          );
          if (!capabilities?.canViewPickups) {
            return json(
              {
                error: {
                  code: "pickup_capability_forbidden",
                  message: "Dieser Collection-Helfer darf keine Pickups sehen oder anlegen.",
                },
              },
              { status: 403 },
            );
          }
        }
      }
    }

    const searchResponse = await handlePickupSearch(request, env);
    if (searchResponse) return searchResponse;

    let response = await baseWorker.fetch(request, env, context);
    if (!env.DB) return response;
    response = await augmentPickupCapabilitiesResponse(request, response, env.DB);
    if (request.method !== "GET") return response;
    const campaignId = snapshotCampaignId(new URL(request.url).pathname);
    if (!campaignId) return response;
    return augmentPickupSnapshotResponse(response, env.DB, campaignId, request);
  },
};

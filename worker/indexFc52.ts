import baseWorker from "./indexM55.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  hasPickupReadSchema,
  loadPickupTasks,
  StoredPickupError,
} from "./pickupRepository.ts";

type Env = Parameters<typeof baseWorker.fetch>[1];

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function augmentPickupSnapshotResponse(
  response: Response,
  db: D1DatabaseLike,
  campaignId: string,
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
    const pickups = await loadPickupTasks(db, campaignId);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return Response.json(
      {
        ...payload,
        collection: {
          ...payload.collection,
          pickups,
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
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await baseWorker.fetch(request, env);
    if (request.method !== "GET" || !env.DB) return response;
    const campaignId = snapshotCampaignId(new URL(request.url).pathname);
    if (!campaignId) return response;
    return augmentPickupSnapshotResponse(response, env.DB, campaignId);
  },
};

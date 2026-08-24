import {
  getCampaignRevision,
  loadCampaignSnapshot,
  replaceCampaignSnapshot,
  StoredSnapshotError,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { parseCampaignId, validateCampaignSnapshot } from "./snapshotValidation.ts";

const MAX_SNAPSHOT_BYTES = 1_500_000;

type Env = {
  DB?: D1DatabaseLike;
};

type ErrorBody = {
  error: {
    code: string;
    message: string;
  };
  revision?: number | null;
};

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init.headers,
    },
  });

function errorResponse(
  status: number,
  code: string,
  message: string,
  revision?: number | null,
) {
  const body: ErrorBody = { error: { code, message } };
  if (revision !== undefined) body.revision = revision;
  return json(body, { status });
}

function campaignRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/(snapshot|version)$/);
  if (!match) return null;

  let decodedId: string;
  try {
    decodedId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const campaignId = parseCampaignId(decodedId);
  if (!campaignId) return null;

  return {
    campaignId,
    resource: match[2] as "snapshot" | "version",
  };
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Snapshot ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_SNAPSHOT_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Snapshot ist zu groß."),
    };
  }

  try {
    return { ok: true as const, value: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON."),
    };
  }
}

async function getSnapshot(db: D1DatabaseLike, campaignId: string) {
  const snapshot = await loadCampaignSnapshot(db, campaignId);
  if (!snapshot) {
    return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  }

  const validation = validateCampaignSnapshot(snapshot, campaignId);
  if (!validation.valid) {
    return errorResponse(
      500,
      "stored_snapshot_invalid",
      "Der gespeicherte Campaign-Stand ist ungültig.",
    );
  }

  return json(validation.snapshot, {
    headers: {
      etag: `"${campaignId}:${snapshot.revision}"`,
    },
  });
}

async function putSnapshot(request: Request, db: D1DatabaseLike, campaignId: string) {
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  if (
    typeof parsedBody.value !== "object" ||
    parsedBody.value === null ||
    Array.isArray(parsedBody.value)
  ) {
    return errorResponse(400, "invalid_request", "Request-Body ist ungültig.");
  }

  const body = parsedBody.value as Record<string, unknown>;
  const baseRevision = body.baseRevision;
  if (
    baseRevision !== null &&
    (typeof baseRevision !== "number" ||
      !Number.isInteger(baseRevision) ||
      baseRevision < 0)
  ) {
    return errorResponse(
      400,
      "invalid_base_revision",
      "baseRevision muss null oder eine nichtnegative Ganzzahl sein.",
    );
  }

  const validation = validateCampaignSnapshot(body.snapshot, campaignId);
  if (!validation.valid) {
    return errorResponse(422, "snapshot_invalid", validation.message);
  }

  const result = await replaceCampaignSnapshot(
    db,
    validation.snapshot,
    baseRevision as number | null,
  );

  if (!result.ok) {
    return errorResponse(
      409,
      "revision_conflict",
      "Der Campaign-Stand wurde auf einem anderen Gerät geändert.",
      result.currentRevision,
    );
  }

  const stored = await loadCampaignSnapshot(db, campaignId);
  if (!stored) {
    return errorResponse(
      500,
      "write_verification_failed",
      "Gespeicherter Campaign-Stand konnte nicht erneut geladen werden.",
    );
  }

  return json(stored, {
    headers: {
      etag: `"${campaignId}:${stored.revision}"`,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "flyer-map",
        version: "0.2.0",
        persistence: env.DB ? "d1" : "unbound",
      });
    }

    const route = campaignRoute(url.pathname);
    if (route) {
      if (!env.DB) {
        return errorResponse(
          503,
          "d1_unavailable",
          "D1 ist für diesen Worker noch nicht gebunden.",
        );
      }

      try {
        if (route.resource === "snapshot") {
          if (request.method === "GET") return await getSnapshot(env.DB, route.campaignId);
          if (request.method === "PUT") {
            return await putSnapshot(request, env.DB, route.campaignId);
          }
          return errorResponse(
            405,
            "method_not_allowed",
            "Für diesen Endpunkt ist nur GET oder PUT erlaubt.",
          );
        }

        if (route.resource === "version") {
          if (request.method !== "GET") {
            return errorResponse(
              405,
              "method_not_allowed",
              "Für diesen Endpunkt ist nur GET erlaubt.",
            );
          }

          const revision = await getCampaignRevision(env.DB, route.campaignId);
          if (revision === null) {
            return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
          }
          return json({ campaignId: route.campaignId, revision });
        }
      } catch (error) {
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
        console.error("campaign_api_error", error);
        return errorResponse(
          500,
          "internal_error",
          "Campaign-Daten konnten nicht verarbeitet werden.",
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return errorResponse(404, "not_found", "API-Endpunkt wurde nicht gefunden.");
    }

    return new Response("Not found", { status: 404 });
  },
};

import {
  campaignExists,
  getCampaignRevision,
  loadCampaignSnapshot,
  replaceCampaignSnapshot,
  StoredSnapshotError,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { parseCampaignId, validateCampaignSnapshot } from "./snapshotValidation.ts";
import {
  campaignHasAccessGrants,
  clearSessionCookie,
  createAccessGrant,
  createSessionForGrant,
  listAccessGrants,
  redeemAccessToken,
  resolveAccess,
  revokeAccessGrant,
  revokeCurrentSession,
  sessionCookie,
  teamExistsInCampaign,
  type AccessContext,
  type AccessRole,
} from "./access.ts";
import { authorizeSnapshotWrite } from "./authorization.ts";
import { createRecoveredAdminAccess, operatorSecretMatches } from "./operatorRecovery.ts";
import { handleCampaignMutation } from "./mutationHandler.ts";
import { handleActivityApi } from "./activity.ts";
import { handleCommentsApi } from "./comments.ts";

const MAX_SNAPSHOT_BYTES = 1_500_000;

type Env = {
  DB?: D1DatabaseLike;
  M4_BOOTSTRAP_SECRET?: string;
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

function mutationRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/mutations$/);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function accessRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/access(?:\/([^/]+))?$/);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const grantId = match[2] ? decodeURIComponent(match[2]) : null;
    if (!campaignId) return null;
    if (grantId && !/^[A-Za-z0-9._:-]{1,200}$/.test(grantId)) return null;
    return { campaignId, grantId };
  } catch {
    return null;
  }
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

function sameOriginWrite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function publicAccess(access: AccessContext) {
  return {
    campaignId: access.campaignId,
    role: access.role,
    teamId: access.teamId,
    label: access.label,
  };
}

async function requireAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
  roles?: AccessRole[],
) {
  const access = await resolveAccess(db, request, campaignId);
  if (!access) {
    return {
      ok: false as const,
      response: errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich."),
    };
  }
  if (roles && !roles.includes(access.role)) {
    return {
      ok: false as const,
      response: errorResponse(403, "forbidden", "Diese Rolle darf die Aktion nicht ausführen."),
    };
  }
  return { ok: true as const, access };
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

async function putSnapshot(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
) {
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
    (typeof baseRevision !== "number" || !Number.isInteger(baseRevision) || baseRevision < 0)
  ) {
    return errorResponse(
      400,
      "invalid_base_revision",
      "baseRevision muss null oder eine nichtnegative Ganzzahl sein.",
    );
  }
  if (baseRevision === null) {
    return errorResponse(
      403,
      "bootstrap_forbidden",
      "Bestehende Campaigns können nicht per Snapshot-PUT übernommen werden.",
    );
  }

  const validation = validateCampaignSnapshot(body.snapshot, campaignId);
  if (!validation.valid) {
    return errorResponse(422, "snapshot_invalid", validation.message);
  }

  const previous = await loadCampaignSnapshot(db, campaignId);
  if (!previous) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");

  const authorization = authorizeSnapshotWrite(access, previous, validation.snapshot);
  if (!authorization.allowed) {
    return errorResponse(
      403,
      "write_forbidden",
      "Die Änderung liegt außerhalb deiner Berechtigung.",
    );
  }

  const result = await replaceCampaignSnapshot(db, validation.snapshot, baseRevision as number);
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

async function createCampaign(request: Request, db: D1DatabaseLike) {
  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const value =
    typeof parsedBody.value === "object" &&
    parsedBody.value !== null &&
    !Array.isArray(parsedBody.value)
      ? (parsedBody.value as Record<string, unknown>).snapshot
      : null;
  const campaignId =
    value && typeof value === "object" && !Array.isArray(value)
      ? parseCampaignId(
          String(
            (value as Record<string, unknown>).campaign &&
              typeof (value as Record<string, unknown>).campaign === "object"
              ? ((value as Record<string, unknown>).campaign as Record<string, unknown>).id ?? ""
              : "",
          ),
        )
      : null;
  if (!campaignId) return errorResponse(400, "invalid_campaign", "Campaign-ID ist ungültig.");

  const validation = validateCampaignSnapshot(value, campaignId);
  if (!validation.valid) return errorResponse(422, "snapshot_invalid", validation.message);
  if (validation.snapshot.revision !== 0) {
    return errorResponse(
      422,
      "initial_revision_invalid",
      "Neue Campaigns müssen mit Revision 0 beginnen.",
    );
  }

  const result = await replaceCampaignSnapshot(db, validation.snapshot, null);
  if (!result.ok) return errorResponse(409, "campaign_exists", "Campaign existiert bereits.");

  const created = await createAccessGrant(db, {
    campaignId,
    role: "admin",
    teamId: null,
    label: "Initial admin",
  });
  const access: AccessContext = {
    grantId: created.grant.grantId,
    campaignId,
    role: "admin",
    teamId: null,
    label: created.grant.label,
  };
  const session = await createSessionForGrant(db, access);
  const stored = await loadCampaignSnapshot(db, campaignId);

  return json(
    {
      snapshot: stored,
      access: publicAccess(access),
      initialAccessToken: created.token,
    },
    { status: 201, headers: { "set-cookie": sessionCookie(session.sessionSecret) } },
  );
}

async function manageAccess(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  grantId: string | null,
) {
  const auth = await requireAccess(db, request, campaignId, ["admin"]);
  if (!auth.ok) return auth.response;

  if (request.method === "GET" && !grantId) {
    return json({ grants: await listAccessGrants(db, campaignId) });
  }

  if (request.method === "POST" && !grantId) {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return errorResponse(400, "invalid_request", "Access-Daten sind ungültig.");
    }
    const body = parsed.value as Record<string, unknown>;
    const role = body.role;
    if (role !== "admin" && role !== "team-editor" && role !== "viewer") {
      return errorResponse(400, "invalid_role", "Access-Rolle ist ungültig.");
    }
    const teamId = typeof body.teamId === "string" ? body.teamId : null;
    if (role === "team-editor") {
      if (!teamId || !(await teamExistsInCampaign(db, campaignId, teamId))) {
        return errorResponse(
          400,
          "invalid_team_scope",
          "Team Editor benötigt ein Team dieser Campaign.",
        );
      }
    } else if (teamId !== null) {
      return errorResponse(
        400,
        "invalid_team_scope",
        "Diese Rolle darf keinen Team-Scope besitzen.",
      );
    }
    const label = typeof body.label === "string" ? body.label.slice(0, 120) : null;
    const created = await createAccessGrant(db, { campaignId, role, teamId, label });
    return json({ grant: created.grant, token: created.token }, { status: 201 });
  }

  if (request.method === "DELETE" && grantId) {
    const revoked = await revokeAccessGrant(db, campaignId, grantId);
    if (!revoked) {
      return errorResponse(404, "grant_not_found", "Access Link wurde nicht gefunden.");
    }
    return json({ ok: true });
  }

  return errorResponse(
    405,
    "method_not_allowed",
    "Methode für Access Management nicht erlaubt.",
  );
}

async function bootstrapCampaign(request: Request, env: Env, db: D1DatabaseLike) {
  if (!env.M4_BOOTSTRAP_SECRET) {
    return errorResponse(
      503,
      "bootstrap_unconfigured",
      "M4 Bootstrap ist serverseitig nicht konfiguriert.",
    );
  }
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return errorResponse(400, "invalid_request", "Bootstrap-Daten sind ungültig.");
  }
  const body = parsed.value as Record<string, unknown>;
  const campaignId =
    typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (!campaignId || !secret) {
    return errorResponse(
      400,
      "invalid_request",
      "Campaign und Bootstrap-Secret sind erforderlich.",
    );
  }

  if (!(await operatorSecretMatches(secret, env.M4_BOOTSTRAP_SECRET))) {
    return errorResponse(403, "bootstrap_forbidden", "Bootstrap-Secret ist ungültig.");
  }
  if (!(await campaignExists(db, campaignId))) {
    return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  }
  if (await campaignHasAccessGrants(db, campaignId)) {
    return errorResponse(
      409,
      "already_bootstrapped",
      "Campaign besitzt bereits Access Grants.",
    );
  }

  const recovered = await createRecoveredAdminAccess(db, campaignId, "M4 bootstrap admin");
  return json(
    {
      access: publicAccess(recovered.access),
      initialAccessToken: recovered.token,
    },
    { headers: { "set-cookie": sessionCookie(recovered.sessionSecret) } },
  );
}

async function recoverCampaignAdmin(request: Request, env: Env, db: D1DatabaseLike) {
  if (!env.M4_BOOTSTRAP_SECRET) {
    return errorResponse(
      503,
      "recovery_unconfigured",
      "Admin-Wiederherstellung ist serverseitig nicht konfiguriert.",
    );
  }

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return errorResponse(400, "invalid_request", "Recovery-Daten sind ungültig.");
  }

  const body = parsed.value as Record<string, unknown>;
  const campaignId =
    typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (!campaignId || !secret) {
    return errorResponse(
      400,
      "invalid_request",
      "Campaign und Recovery-Secret sind erforderlich.",
    );
  }

  if (!(await operatorSecretMatches(secret, env.M4_BOOTSTRAP_SECRET))) {
    return errorResponse(403, "recovery_forbidden", "Recovery-Secret ist ungültig.");
  }
  if (!(await campaignExists(db, campaignId))) {
    return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  }

  const recovered = await createRecoveredAdminAccess(db, campaignId);
  return json(
    {
      access: publicAccess(recovered.access),
      initialAccessToken: recovered.token,
    },
    { headers: { "set-cookie": sessionCookie(recovered.sessionSecret) } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "flyer-map",
        version: "0.4.0",
        persistence: env.DB ? "d1" : "unbound",
        authorization: "access-links",
        synchronization: "durable-mutations",
      });
    }

    if (!sameOriginWrite(request)) {
      return errorResponse(
        403,
        "origin_forbidden",
        "Cross-Origin-Schreibzugriffe sind nicht erlaubt.",
      );
    }

    if (!env.DB && url.pathname.startsWith("/api/")) {
      return errorResponse(
        503,
        "d1_unavailable",
        "D1 ist für diesen Worker noch nicht gebunden.",
      );
    }
    const db = env.DB;

    if (db) {
      const commentsResponse = await handleCommentsApi(request, db);
      if (commentsResponse) return commentsResponse;

      const activityResponse = await handleActivityApi(request, db);
      if (activityResponse) return activityResponse;
    }

    if (db && url.pathname === "/api/campaigns" && request.method === "POST") {
      try {
        return await createCampaign(request, db);
      } catch {
        return errorResponse(500, "internal_error", "Campaign konnte nicht erstellt werden.");
      }
    }

    if (db && url.pathname === "/api/access/redeem" && request.method === "POST") {
      const parsed = await readJsonBody(request);
      if (!parsed.ok) return parsed.response;
      if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
        return errorResponse(400, "invalid_request", "Access Token ist ungültig.");
      }
      const body = parsed.value as Record<string, unknown>;
      const campaignId =
        typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
      const token = typeof body.token === "string" ? body.token : "";
      if (!campaignId || !token) {
        return errorResponse(
          400,
          "invalid_request",
          "Campaign und Access Token sind erforderlich.",
        );
      }
      try {
        const redeemed = await redeemAccessToken(db, campaignId, token);
        if (!redeemed) {
          return errorResponse(
            401,
            "invalid_access_token",
            "Access Token ist ungültig oder widerrufen.",
          );
        }
        return json(
          { access: publicAccess(redeemed.access) },
          { headers: { "set-cookie": sessionCookie(redeemed.sessionSecret) } },
        );
      } catch {
        return errorResponse(
          500,
          "internal_error",
          "Access Token konnte nicht eingelöst werden.",
        );
      }
    }

    if (db && url.pathname === "/api/access/current" && request.method === "GET") {
      const campaignId = parseCampaignId(url.searchParams.get("campaign") ?? "");
      if (!campaignId) {
        return errorResponse(400, "invalid_campaign", "Campaign-ID ist ungültig.");
      }
      const access = await resolveAccess(db, request, campaignId);
      if (!access) {
        return errorResponse(
          401,
          "access_required",
          "Gültiger Campaign-Zugriff ist erforderlich.",
        );
      }
      return json({ access: publicAccess(access) });
    }

    if (db && url.pathname === "/api/access/logout" && request.method === "POST") {
      await revokeCurrentSession(db, request);
      return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
    }

    if (db && url.pathname === "/api/admin/bootstrap" && request.method === "POST") {
      try {
        return await bootstrapCampaign(request, env, db);
      } catch {
        return errorResponse(
          500,
          "internal_error",
          "Campaign-Bootstrap ist fehlgeschlagen.",
        );
      }
    }

    if (db && url.pathname === "/api/admin/recover" && request.method === "POST") {
      try {
        return await recoverCampaignAdmin(request, env, db);
      } catch {
        return errorResponse(
          500,
          "internal_error",
          "Admin-Wiederherstellung ist fehlgeschlagen.",
        );
      }
    }

    if (db) {
      const accessManagement = accessRoute(url.pathname);
      if (accessManagement) {
        try {
          return await manageAccess(
            request,
            db,
            accessManagement.campaignId,
            accessManagement.grantId,
          );
        } catch {
          return errorResponse(
            500,
            "internal_error",
            "Access Management ist fehlgeschlagen.",
          );
        }
      }
    }

    const mutationCampaignId = mutationRoute(url.pathname);
    if (mutationCampaignId && db) {
      try {
        const auth = await requireAccess(db, request, mutationCampaignId);
        if (!auth.ok) return auth.response;
        return await handleCampaignMutation(request, db, mutationCampaignId, auth.access);
      } catch (error) {
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
        return errorResponse(500, "internal_error", "Mutation konnte nicht verarbeitet werden.");
      }
    }

    const route = campaignRoute(url.pathname);
    if (route && db) {
      try {
        const auth = await requireAccess(db, request, route.campaignId);
        if (!auth.ok) return auth.response;

        if (route.resource === "snapshot") {
          if (request.method === "GET") return await getSnapshot(db, route.campaignId);
          if (request.method === "PUT") {
            if (auth.access.role === "viewer") {
              return errorResponse(
                403,
                "viewer_read_only",
                "Read-only Viewer dürfen nichts verändern.",
              );
            }
            return await putSnapshot(request, db, route.campaignId, auth.access);
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

          const revision = await getCampaignRevision(db, route.campaignId);
          if (revision === null) {
            return errorResponse(
              404,
              "campaign_not_found",
              "Campaign wurde nicht gefunden.",
            );
          }
          return json({ campaignId: route.campaignId, revision });
        }
      } catch (error) {
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
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

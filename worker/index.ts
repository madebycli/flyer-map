import {
  campaignExists,
  getCampaignRevision,
  loadCampaignSnapshot,
  createInitialCampaignState,
  hasCollectionSchema,
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
import {
  clearCollectionSessionCookie,
  createCollectionAccessLink,
  isCollectionSchemaError,
  listCollectionAccessLinks,
  listCollectionCollectors,
  redeemCollectionAccess,
  resolveCollectionAccess,
  revokeCollectionCollector,
  revokeCollectionSession,
  collectionSessionCookie,
} from "./collectionAccess.ts";
import { collectionSnapshotOrEmpty } from "../src/domain/collection.ts";
import { createRecoveredAdminAccess, operatorSecretMatches } from "./operatorRecovery.ts";
import { handleCampaignMutation } from "./mutationHandler.ts";
import { handleActivityApi } from "./activity.ts";
import { handleCommentsApi } from "./comments.ts";
import { handleAutomationsApi } from "./automationConfig.ts";
import { handleStatisticsApi } from "./statistics.ts";
import {
  areaTaskPreparationRoute,
  handleAreaTaskPreparationApi,
} from "./areaTaskPreparationApi.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";
import {
  adminAccountSessionCookie,
  clearAdminAccountSessionCookie,
  completeCampaignAdminPasswordReset,
  completeCampaignAdminSetup,
  createCampaignAdminPasswordResetInvite,
  createCampaignAdminSetupInvite,
  disableCampaignAdminAccount,
  hasCampaignAdminAuthSchema,
  hasCampaignAdminPasswordResetSchema,
  listCampaignAdminAccounts,
  loginCampaignAdminAccount,
  renameCampaignAdminAccount,
  revokeCurrentCampaignAdminAccountSession,
} from "./adminAuth.ts";

const MAX_SNAPSHOT_BYTES = 1_500_000;

type Env = {
  DB?: D1DatabaseLike;
  M4_BOOTSTRAP_SECRET?: string;
  OSM_OVERPASS_URL?: string;
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


function collectionSnapshotRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/collection\/snapshot$/);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function collectionAccessRoute(pathname: string) {
  const match = pathname.match(/^\/api\/collection\/access\/(redeem|current|logout)$/);
  return match ? match[1] : null;
}

function collectionManagementRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/collection\/(access|collectors)(?:\/([^/]+))?$/);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const resource = match[2] as "access" | "collectors";
    const id = match[3] ? decodeURIComponent(match[3]) : null;
    if (!campaignId || (id && !/^[A-Za-z0-9._:-]{1,200}$/.test(id))) return null;
    return { campaignId, resource, id };
  } catch {
    return null;
  }
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

function campaignAdminAccountRoute(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/admin-accounts(?:\/(.*))?$/);
  if (!match) return null;
  try {
    const campaignId = parseCampaignId(decodeURIComponent(match[1]));
    const suffix = match[2] ? match[2].split("/").map((part) => decodeURIComponent(part)) : [];
    if (!campaignId) return null;
    if (suffix.length === 0) return { campaignId, kind: "collection" as const, accountId: null };
    if (suffix.length === 1 && suffix[0] === "login") return { campaignId, kind: "login" as const, accountId: null };
    if (suffix.length === 1 && suffix[0] === "setup-invites") return { campaignId, kind: "setup-invites" as const, accountId: null };
    if (suffix.length === 1 && /^[A-Za-z0-9._:-]{1,200}$/.test(suffix[0])) {
      return { campaignId, kind: "account" as const, accountId: suffix[0] };
    }
    if (suffix.length === 2 && /^[A-Za-z0-9._:-]{1,200}$/.test(suffix[0]) && suffix[1] === "password-reset") {
      return { campaignId, kind: "password-reset" as const, accountId: suffix[0] };
    }
    return null;
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
    collectorId: access.collectorId ?? null,
    collectionAccessId: access.collectionAccessId ?? null,
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


async function requireCollectionReadAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
) {
  const normal = await resolveAccess(db, request, campaignId);
  if (normal) {
    if (normal.role === "field-group-member") {
      return {
        ok: false as const,
        response: errorResponse(403, "collection_scope_forbidden", "Dieser Zugriff ist nicht für Collection freigeschaltet."),
      };
    }
    return { ok: true as const, access: normal };
  }
  const collector = await resolveCollectionAccess(db, request, campaignId);
  if (!collector) {
    return {
      ok: false as const,
      response: errorResponse(401, "access_required", "Gültiger Collection-Zugriff ist erforderlich."),
    };
  }
  return { ok: true as const, access: collector };
}

async function requireMutationAccess(
  db: D1DatabaseLike,
  request: Request,
  campaignId: string,
) {
  const normal = await resolveAccess(db, request, campaignId);
  if (normal) return { ok: true as const, access: normal };
  const collector = await resolveCollectionAccess(db, request, campaignId);
  if (!collector) {
    return {
      ok: false as const,
      response: errorResponse(401, "access_required", "Gültiger Campaign-Zugriff ist erforderlich."),
    };
  }
  return { ok: true as const, access: collector };
}

async function getCollectionSnapshot(db: D1DatabaseLike, campaignId: string) {
  if (!(await hasCollectionSchema(db))) {
    return errorResponse(503, "schema_migration_required", "Collection ist vorbereitet, aber Migration 0010 ist noch nicht angewendet.");
  }
  const snapshot = await loadCampaignSnapshot(db, campaignId);
  if (!snapshot) return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
  const validation = validateCampaignSnapshot(snapshot, campaignId);
  if (!validation.valid) return errorResponse(500, "stored_snapshot_invalid", "Der gespeicherte Collection-Stand ist ungültig.");
  return json({
    ...validation.snapshot,
    teams: [],
    areas: [],
    tasks: [],
    houseTasks: [],
    collection: collectionSnapshotOrEmpty(validation.snapshot.collection),
  }, { headers: { etag: '"' + campaignId + ':' + snapshot.revision + ':collection"' } });
}

async function manageCollection(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  resource: "access" | "collectors",
  id: string | null,
) {
  const auth = await requireAccess(db, request, campaignId, ["admin"]);
  if (!auth.ok) return auth.response;
  if (resource === "access" && request.method === "POST" && !id) {
    const result = await createCollectionAccessLink(db, campaignId);
    return json(result, { status: 201 });
  }
  if (resource === "access" && request.method === "GET" && !id) {
    return json({ links: await listCollectionAccessLinks(db, campaignId) });
  }
  if (resource === "collectors" && request.method === "GET" && !id) {
    return json({ collectors: await listCollectionCollectors(db, campaignId) });
  }
  if (resource === "collectors" && request.method === "DELETE" && id) {
    if (!(await revokeCollectionCollector(db, campaignId, id))) {
      return errorResponse(404, "collector_not_found", "Collection-Helfer wurde nicht gefunden.");
    }
    return json({ ok: true });
  }
  return errorResponse(405, "method_not_allowed", "Collection-Management-Methode nicht erlaubt.");
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

export function legacySnapshotWriteResponse() {
  return errorResponse(
    410,
    "legacy_snapshot_write_retired",
    "Campaign-Änderungen müssen über den Mutationspfad gespeichert werden.",
  );
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

  const result = await createInitialCampaignState(db, validation.snapshot);
  if (!result.ok) {
    if (result.reason === "campaign_exists") {
      return errorResponse(409, "campaign_exists", "Campaign existiert bereits.");
    }
    if (result.reason === "schema_migration_required") {
      return errorResponse(
        503,
        "schema_migration_required",
        "Die initiale Campaign benötigt eine vorbereitete D1-Migration.",
      );
    }
    return errorResponse(
      422,
      "initial_revision_invalid",
      "Neue Campaigns müssen mit Revision 0 beginnen.",
    );
  }

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
  if (!stored) {
    return errorResponse(
      500,
      "write_verification_failed",
      "Gespeicherter Campaign-Stand konnte nicht erneut geladen werden.",
    );
  }

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

async function requireCampaignAdminAuthSchema(db: D1DatabaseLike) {
  if (await hasCampaignAdminAuthSchema(db)) return null;
  return errorResponse(
    503,
    "admin_account_schema_unavailable",
    "Campaign-Admin-Konten benötigen die vorbereitete Migration 0015.",
  );
}

async function requireCampaignAdminPasswordResetSchema(db: D1DatabaseLike) {
  if (await hasCampaignAdminPasswordResetSchema(db)) return null;
  return errorResponse(
    503,
    "admin_password_reset_schema_unavailable",
    "Campaign-Admin-Passwort-Resets benötigen die vorbereitete Migration 0016.",
  );
}

async function manageCampaignAdminAccounts(
  request: Request,
  db: D1DatabaseLike,
  route: {
    campaignId: string;
    kind: "collection" | "login" | "setup-invites" | "account" | "password-reset";
    accountId: string | null;
  },
) {
  const schemaError = await requireCampaignAdminAuthSchema(db);
  if (schemaError) return schemaError;

  if (route.kind === "login" && request.method === "POST") {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return errorResponse(400, "invalid_request", "Anmeldedaten sind ungültig.");
    }
    const body = parsed.value as Record<string, unknown>;
    const loggedIn = await loginCampaignAdminAccount(db, {
      campaignId: route.campaignId,
      username: body.username,
      password: body.password,
    });
    if (!loggedIn.ok) {
      return errorResponse(401, "invalid_admin_credentials", "Benutzername oder Passwort ist ungültig.");
    }
    return json(
      { access: publicAccess(loggedIn.access) },
      { headers: { "set-cookie": adminAccountSessionCookie(loggedIn.session.sessionSecret) } },
    );
  }

  const auth = await requireAccess(db, request, route.campaignId, ["admin"]);
  if (!auth.ok) return auth.response;

  if (route.kind === "collection" && request.method === "GET") {
    return json({ accounts: await listCampaignAdminAccounts(db, route.campaignId) });
  }
  if (route.kind === "setup-invites" && request.method === "POST") {
    const invite = await createCampaignAdminSetupInvite(db, route.campaignId);
    return json(invite, { status: 201 });
  }
  if (route.kind === "password-reset" && route.accountId && request.method === "POST") {
    const resetSchemaError = await requireCampaignAdminPasswordResetSchema(db);
    if (resetSchemaError) return resetSchemaError;
    const invite = await createCampaignAdminPasswordResetInvite(db, route.campaignId, route.accountId);
    if (!invite) return errorResponse(404, "admin_account_not_found", "Aktives Admin-Konto wurde nicht gefunden.");
    return json(invite, { status: 201 });
  }
  if (route.kind === "account" && route.accountId && request.method === "PATCH") {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return errorResponse(400, "invalid_request", "Admin-Kontodaten sind ungültig.");
    }
    const renamed = await renameCampaignAdminAccount(
      db,
      route.campaignId,
      route.accountId,
      (parsed.value as Record<string, unknown>).username,
    );
    if (!renamed.ok) {
      const message = renamed.code === "username_unavailable"
        ? "Dieser Benutzername ist in dieser Campaign bereits vergeben."
        : renamed.code === "account_not_found"
          ? "Admin-Konto wurde nicht gefunden."
          : "Der Benutzername muss 3 bis 40 Zeichen aus Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich enthalten.";
      return errorResponse(400, renamed.code, message);
    }
    return json({ ok: true, username: renamed.username });
  }
  if (route.kind === "account" && route.accountId && request.method === "DELETE") {
    const disabled = await disableCampaignAdminAccount(db, route.campaignId, route.accountId);
    if (disabled === "not_found") return errorResponse(404, "admin_account_not_found", "Admin-Konto wurde nicht gefunden.");
    if (disabled === "last_account") {
      return errorResponse(409, "last_admin_account", "Das letzte aktive Admin-Konto kann nicht gesperrt werden.");
    }
    return json({ ok: true });
  }
  return errorResponse(405, "method_not_allowed", "Methode für Campaign-Admin-Konten nicht erlaubt.");
}

async function completeCampaignAdminAccountSetup(
  request: Request,
  db: D1DatabaseLike,
) {
  const schemaError = await requireCampaignAdminAuthSchema(db);
  if (schemaError) return schemaError;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return errorResponse(400, "invalid_request", "Einrichtungsdaten sind ungültig.");
  }
  const body = parsed.value as Record<string, unknown>;
  const campaignId = typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
  const token = typeof body.token === "string" ? body.token : "";
  if (!campaignId) return errorResponse(400, "invalid_campaign", "Campaign-ID ist ungültig.");
  const completed = await completeCampaignAdminSetup(db, {
    campaignId,
    token,
    username: body.username,
    password: body.password,
  });
  if (!completed.ok) {
    const message = completed.code === "username_unavailable"
      ? "Dieser Benutzername ist in dieser Campaign bereits vergeben."
      : completed.code === "setup_link_invalid"
        ? "Der Einrichtungslink ist ungültig, abgelaufen oder bereits verwendet."
        : "Benutzername, Passwort oder Einrichtungslink sind ungültig.";
    return errorResponse(400, completed.code, message);
  }
  return json(
    { access: publicAccess(completed.access) },
    { headers: { "set-cookie": adminAccountSessionCookie(completed.session.sessionSecret) } },
  );
}

async function completeCampaignAdminAccountPasswordReset(
  request: Request,
  db: D1DatabaseLike,
) {
  const schemaError = await requireCampaignAdminAuthSchema(db) ?? await requireCampaignAdminPasswordResetSchema(db);
  if (schemaError) return schemaError;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return errorResponse(400, "invalid_request", "Passwort-Reset-Daten sind ungültig.");
  }
  const body = parsed.value as Record<string, unknown>;
  const campaignId = typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
  const token = typeof body.token === "string" ? body.token : "";
  if (!campaignId) return errorResponse(400, "invalid_campaign", "Campaign-ID ist ungültig.");
  const completed = await completeCampaignAdminPasswordReset(db, {
    campaignId,
    token,
    password: body.password,
  });
  if (!completed.ok) {
    const message = completed.code === "reset_link_invalid"
      ? "Der Passwort-Reset-Link ist ungültig, abgelaufen oder bereits verwendet."
      : "Passwort oder Reset-Link sind ungültig.";
    return errorResponse(400, completed.code, message);
  }
  return json(
    { access: publicAccess(completed.access) },
    { headers: { "set-cookie": adminAccountSessionCookie(completed.session.sessionSecret) } },
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
  async fetch(
    request: Request,
    env: Env,
    context?: AreaPreparationExecutionContext,
  ): Promise<Response> {
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

    const snapshotWriteRoute = campaignRoute(url.pathname);
    if (snapshotWriteRoute?.resource === "snapshot" && request.method === "PUT") {
      return legacySnapshotWriteResponse();
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
      const collectionAccess = collectionAccessRoute(url.pathname);
      if (collectionAccess === "redeem" && request.method === "POST") {
        const parsed = await readJsonBody(request);
        if (!parsed.ok) return parsed.response;
        if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
          return errorResponse(400, "invalid_request", "Collection Token ist ungültig.");
        }
        const body = parsed.value as Record<string, unknown>;
        const campaignId = typeof body.campaignId === "string" ? parseCampaignId(body.campaignId) : null;
        const token = typeof body.token === "string" ? body.token : "";
        if (!campaignId || !token) {
          return errorResponse(400, "invalid_request", "Campaign und Collection Token sind erforderlich.");
        }
        try {
          const redeemed = await redeemCollectionAccess(db, campaignId, token);
          if (!redeemed) return errorResponse(401, "invalid_collection_token", "Collection-QR ist ungültig oder widerrufen.");
          return json(
            { access: publicAccess(redeemed.access) },
            { headers: { "set-cookie": collectionSessionCookie(redeemed.sessionSecret) } },
          );
        } catch (error) {
          if (isCollectionSchemaError(error)) {
            return errorResponse(503, "schema_migration_required", "Collection ist vorbereitet, aber Migration 0010 ist noch nicht angewendet.");
          }
          return errorResponse(500, "internal_error", "Collection-Zugang konnte nicht eingelöst werden.");
        }
      }
      if (collectionAccess === "current" && request.method === "GET") {
        const campaignId = parseCampaignId(url.searchParams.get("campaign") ?? "");
        if (!campaignId) return errorResponse(400, "invalid_campaign", "Campaign-ID ist ungültig.");
        if (!(await hasCollectionSchema(db))) {
          return errorResponse(503, "schema_migration_required", "Collection ist vorbereitet, aber Migration 0010 ist noch nicht angewendet.");
        }
        const access = await resolveCollectionAccess(db, request, campaignId);
        if (!access) return errorResponse(401, "access_required", "Gültiger Collection-Zugriff ist erforderlich.");
        return json({ access: publicAccess(access) });
      }
      if (collectionAccess === "logout" && request.method === "POST") {
        await revokeCollectionSession(db, request);
        return json({ ok: true }, { headers: { "set-cookie": clearCollectionSessionCookie() } });
      }
    }

    if (db) {
      const commentsResponse = await handleCommentsApi(request, db);
      if (commentsResponse) return commentsResponse;

      const activityResponse = await handleActivityApi(request, db);
      if (activityResponse) return activityResponse;

      const statisticsResponse = await handleStatisticsApi(request, db);
      if (statisticsResponse) return statisticsResponse;

      const automationsResponse = await handleAutomationsApi(request, db);
      if (automationsResponse) return automationsResponse;
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

    if (db && url.pathname === "/api/admin-accounts/setup" && request.method === "POST") {
      try {
        return await completeCampaignAdminAccountSetup(request, db);
      } catch {
        return errorResponse(500, "internal_error", "Admin-Konto konnte nicht eingerichtet werden.");
      }
    }

    if (db && url.pathname === "/api/admin-accounts/password-reset" && request.method === "POST") {
      try {
        return await completeCampaignAdminAccountPasswordReset(request, db);
      } catch {
        return errorResponse(500, "internal_error", "Admin-Passwort konnte nicht zurückgesetzt werden.");
      }
    }

    if (db && url.pathname === "/api/admin-accounts/logout" && request.method === "POST") {
      await revokeCurrentCampaignAdminAccountSession(db, request);
      return json(
        { ok: true },
        { headers: { "set-cookie": clearAdminAccountSessionCookie() } },
      );
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
      await revokeCurrentCampaignAdminAccountSession(db, request);
      const response = json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
      response.headers.append("set-cookie", clearAdminAccountSessionCookie());
      return response;
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
      const collectionManagement = collectionManagementRoute(url.pathname);
      if (collectionManagement) {
        try {
          return await manageCollection(
            request,
            db,
            collectionManagement.campaignId,
            collectionManagement.resource,
            collectionManagement.id,
          );
        } catch (error) {
          if (isCollectionSchemaError(error)) {
            return errorResponse(503, "schema_migration_required", "Collection ist vorbereitet, aber Migration 0010 ist noch nicht angewendet.");
          }
          return errorResponse(500, "internal_error", "Collection-Management ist fehlgeschlagen.");
        }
      }

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

      const adminAccountManagement = campaignAdminAccountRoute(url.pathname);
      if (adminAccountManagement) {
        try {
          return await manageCampaignAdminAccounts(request, db, adminAccountManagement);
        } catch {
          return errorResponse(
            500,
            "internal_error",
            "Campaign-Admin-Konten konnten nicht verarbeitet werden.",
          );
        }
      }
    }

    const preparationRoute = areaTaskPreparationRoute(url.pathname);
    if (preparationRoute && db) {
      try {
        const auth = await requireAccess(db, request, preparationRoute.campaignId);
        if (!auth.ok) return auth.response;
        return await handleAreaTaskPreparationApi(
          request,
          db,
          preparationRoute,
          auth.access,
          context,
          { upstreamUrl: env.OSM_OVERPASS_URL },
        );
      } catch (error) {
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
        return errorResponse(500, "internal_error", "Area-Vorbereitung konnte nicht verarbeitet werden.");
      }
    }

    const mutationCampaignId = mutationRoute(url.pathname);
    if (mutationCampaignId && db) {
      try {
        const auth = await requireMutationAccess(db, request, mutationCampaignId);
        if (!auth.ok) return auth.response;
        return await handleCampaignMutation(request, db, mutationCampaignId, auth.access, context, {
          upstreamUrl: env.OSM_OVERPASS_URL,
        });
      } catch (error) {
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
        return errorResponse(500, "internal_error", "Mutation konnte nicht verarbeitet werden.");
      }
    }


    const collectionCampaignId = collectionSnapshotRoute(url.pathname);
    if (collectionCampaignId && db) {
      if (request.method !== "GET") {
        return errorResponse(405, "method_not_allowed", "Für Collection-Snapshots ist nur GET erlaubt.");
      }
      try {
        const auth = await requireCollectionReadAccess(db, request, collectionCampaignId);
        if (!auth.ok) return auth.response;
        return await getCollectionSnapshot(db, collectionCampaignId);
      } catch (error) {
        if (isCollectionSchemaError(error)) {
          return errorResponse(503, "schema_migration_required", "Collection ist vorbereitet, aber Migration 0010 ist noch nicht angewendet.");
        }
        if (error instanceof StoredSnapshotError) {
          return errorResponse(500, "stored_snapshot_invalid", error.message);
        }
        return errorResponse(500, "internal_error", "Collection-Daten konnten nicht geladen werden.");
      }
    }

    const route = snapshotWriteRoute;
    if (route && db) {
      try {
        const auth = await requireAccess(db, request, route.campaignId);
        if (!auth.ok) return auth.response;

        if (route.resource === "snapshot") {
          if (request.method === "GET") return await getSnapshot(db, route.campaignId);
          return errorResponse(
            405,
            "method_not_allowed",
            "Für diesen Endpunkt ist nur GET erlaubt.",
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

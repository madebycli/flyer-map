import { cookieValue } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  beginOrganizationPasswordLogin,
  bootstrapOrganization,
  clearOrganizationAccountSessionCookie,
  clearOrganizationLoginChallengeCookie,
  completeOrganizationRecoveryLogin,
  completeOrganizationTotpLogin,
  disableOrganizationMembership,
  listOrganizationMemberships,
  normalizeOrganizationUsername,
  organizationAccountSessionCookie,
  organizationBootstrapSecretMatches,
  organizationLoginChallengeCookie,
  requireOrganizationCapability,
  resolveOrganizationAccountSession,
  revokeOrganizationAccountSession,
  type OrganizationCapability,
} from "./organizationAuth.ts";

const MAX_BODY_BYTES = 96_000;
const LOGIN_CHALLENGE_COOKIE = "__Host-vf_organization_login";
const SELECTOR_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

export type OrganizationApiEnv = {
  DB?: D1DatabaseLike;
  ORGANIZATION_BOOTSTRAP_SECRET?: string;
  ORGANIZATION_TOTP_KEY?: string;
  ORGANIZATION_LOGIN_LIMITER?: RateLimitBinding;
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

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false as const, response: errorResponse(413, "payload_too_large", "Request ist zu groß.") };
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return { ok: false as const, response: errorResponse(413, "payload_too_large", "Request ist zu groß.") };
  }
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false as const, response: errorResponse(400, "invalid_request", "Request-Daten sind ungültig.") };
    }
    return { ok: true as const, value: value as Record<string, unknown> };
  } catch {
    return { ok: false as const, response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON.") };
  }
}

function sameOriginWrite(request: Request) {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function selector(value: string) {
  return SELECTOR_PATTERN.test(value) ? value : null;
}

function organizationCampaignRoute(pathname: string) {
  const match = pathname.match(/^\/api\/organizations\/([^/]+)\/campaigns(?:\/([^/]+))?$/u);
  if (!match) return null;
  try {
    const organizationId = selector(decodeURIComponent(match[1]));
    const campaignId = match[2] ? selector(decodeURIComponent(match[2])) : null;
    return organizationId ? { organizationId, campaignId } : null;
  } catch {
    return null;
  }
}

function organizationMemberRoute(pathname: string) {
  const match = pathname.match(/^\/api\/organizations\/([^/]+)\/members(?:\/([^/]+))?$/u);
  if (!match) return null;
  try {
    const organizationId = selector(decodeURIComponent(match[1]));
    const membershipId = match[2] ? selector(decodeURIComponent(match[2])) : null;
    return organizationId ? { organizationId, membershipId } : null;
  } catch {
    return null;
  }
}

async function hasOrganizationSchema(db: D1DatabaseLike) {
  try {
    const tables = await Promise.all([
      db.prepare("PRAGMA table_info(organizations)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(organization_account_sessions)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(organization_memberships)").all<{ name: string }>(),
    ]);
    return tables.every((table) => table.results.length > 0);
  } catch {
    return false;
  }
}

function appendCookie(response: Response, cookie: string) {
  response.headers.append("set-cookie", cookie);
  return response;
}

type OrganizationAuthorizationErrorCode = "authentication_required" | "mfa_required" | "forbidden";

function isOrganizationAuthorizationErrorCode(code: string): code is OrganizationAuthorizationErrorCode {
  return code === "authentication_required" || code === "mfa_required" || code === "forbidden";
}

function authError(code: string) {
  if (!isOrganizationAuthorizationErrorCode(code)) {
    return errorResponse(500, "authorization_error", "Organization-Autorisierung ist fehlgeschlagen.");
  }
  if (code === "authentication_required") {
    return errorResponse(401, code, "Organization-Anmeldung ist erforderlich.");
  }
  if (code === "mfa_required") {
    return errorResponse(403, code, "Für diese Aktion ist eine vollständig bestätigte MFA-Sitzung erforderlich.");
  }
  return errorResponse(403, code, "Diese Organization-Berechtigung fehlt.");
}

async function audit(
  db: D1DatabaseLike,
  organizationId: string,
  actorAccountId: string | null,
  eventType: string,
  targetType: string | null,
  targetId: string | null,
  details: Record<string, unknown> = {},
) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `org_audit_${crypto.randomUUID()}`,
        organizationId,
        actorAccountId,
        eventType,
        targetType,
        targetId,
        JSON.stringify(details),
        new Date().toISOString(),
      ),
  ]);
}

async function createOrganization(request: Request, db: D1DatabaseLike) {
  const session = await resolveOrganizationAccountSession(db, request);
  if (!session) return errorResponse(401, "authentication_required", "Organization-Anmeldung ist erforderlich.");
  if (session.assurance !== "mfa") return errorResponse(403, "mfa_required", "MFA ist erforderlich.");
  const memberships = await listOrganizationMemberships(db, session.accountId);
  if (!memberships.some((membership) => membership.role === "organizer")) {
    return errorResponse(403, "forbidden", "Nur Organizer dürfen weitere Organizations anlegen.");
  }
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    return errorResponse(400, "invalid_organization_name", "Organization-Name muss 2 bis 120 Zeichen lang sein.");
  }
  const organizationId = `org_${crypto.randomUUID()}`;
  const membershipId = `org_membership_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const result = await db.batch([
    db.prepare("INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(organizationId, name, now, now),
    db
      .prepare(
        `INSERT INTO organization_memberships
          (id, organization_id, account_id, role_kind, role_template_id, capabilities_json, disabled_at, created_at, updated_at)
         VALUES (?, ?, ?, 'organizer', NULL, '[]', NULL, ?, ?)`,
      )
      .bind(membershipId, organizationId, session.accountId, now, now),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'organization.create', 'organization', ?, '{}', ?)`,
      )
      .bind(`org_audit_${crypto.randomUUID()}`, organizationId, session.accountId, organizationId, now),
  ]);
  if (result.some((item) => item.success === false)) {
    return errorResponse(500, "organization_create_failed", "Organization konnte nicht angelegt werden.");
  }
  return json({ organization: { id: organizationId, name } }, { status: 201 });
}

function mapInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lng = Number(record.lng);
  const lat = Number(record.lat);
  const zoom = Number(record.zoom);
  const bearing = Number(record.bearing ?? 0);
  if (![lng, lat, zoom, bearing].every(Number.isFinite)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90 || zoom < 0 || zoom > 24) return null;
  return { lng, lat, zoom, bearing };
}

async function createOrganizationCampaign(
  request: Request,
  db: D1DatabaseLike,
  organizationId: string,
) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "campaign.create");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  const lifecycle = parsed.value.lifecycle === "active" ? "active" : "draft";
  const map = parsed.value.map === undefined ? null : mapInput(parsed.value.map);
  if (name.length < 2 || name.length > 160) {
    return errorResponse(400, "invalid_campaign_name", "Aktionsname muss 2 bis 160 Zeichen lang sein.");
  }
  if (parsed.value.map !== undefined && !map) {
    return errorResponse(400, "invalid_map_focus", "Kartenfokus ist ungültig.");
  }
  const campaignId = `campaign_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `INSERT INTO campaigns (
           id, name, status, revision, write_token,
           map_center_lng, map_center_lat, map_zoom, map_bearing,
           organization_id, admin_lifecycle_status, created_at, updated_at
         ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        campaignId,
        name,
        lifecycle,
        crypto.randomUUID(),
        map?.lng ?? null,
        map?.lat ?? null,
        map?.zoom ?? null,
        map?.bearing ?? null,
        organizationId,
        lifecycle,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO organization_audit_events
          (id, organization_id, actor_account_id, event_type, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, 'campaign.create', 'campaign', ?, ?, ?)`,
      )
      .bind(
        `org_audit_${crypto.randomUUID()}`,
        organizationId,
        auth.session.accountId,
        campaignId,
        JSON.stringify({ lifecycle }),
        now,
      ),
  ]);
  if (result.some((item) => item.success === false)) {
    return errorResponse(500, "campaign_create_failed", "Aktion konnte nicht erstellt werden.");
  }
  return json({ campaign: { id: campaignId, name, lifecycle, map } }, { status: 201 });
}

async function listOrganizationCampaigns(
  request: Request,
  db: D1DatabaseLike,
  organizationId: string,
) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "campaign.manage");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT id, name, admin_lifecycle_status,
              map_center_lng, map_center_lat, map_zoom, map_bearing,
              created_at, updated_at
       FROM campaigns
       WHERE organization_id = ?
       ORDER BY updated_at DESC, id`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      name: string;
      admin_lifecycle_status: "draft" | "active" | "completed" | "archived";
      map_center_lng: number | null;
      map_center_lat: number | null;
      map_zoom: number | null;
      map_bearing: number | null;
      created_at: string;
      updated_at: string;
    }>();
  return json({
    campaigns: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      lifecycle: row.admin_lifecycle_status,
      map: row.map_center_lng !== null && row.map_center_lat !== null && row.map_zoom !== null
        ? {
            lng: row.map_center_lng,
            lat: row.map_center_lat,
            zoom: row.map_zoom,
            bearing: row.map_bearing ?? 0,
          }
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

async function updateOrganizationCampaign(
  request: Request,
  db: D1DatabaseLike,
  organizationId: string,
  campaignId: string,
) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "campaign.manage");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const lifecycle = parsed.value.lifecycle;
  if (lifecycle !== "draft" && lifecycle !== "active" && lifecycle !== "completed" && lifecycle !== "archived") {
    return errorResponse(400, "invalid_campaign_lifecycle", "Aktionsstatus ist ungültig.");
  }
  const baseStatus = lifecycle === "archived" ? "archived" : lifecycle === "draft" ? "draft" : "active";
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE campaigns
         SET status = ?, admin_lifecycle_status = ?, updated_at = ?
         WHERE id = ? AND organization_id = ?`,
      )
      .bind(baseStatus, lifecycle, now, campaignId, organizationId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) {
    return errorResponse(404, "campaign_not_found", "Aktion wurde in dieser Organization nicht gefunden.");
  }
  await audit(db, organizationId, auth.session.accountId, "campaign.lifecycle", "campaign", campaignId, { lifecycle });
  return json({ ok: true, lifecycle });
}

async function listOrganizationMembers(
  request: Request,
  db: D1DatabaseLike,
  organizationId: string,
) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT m.id, m.account_id, a.username, m.role_kind, m.capabilities_json,
              m.created_at, m.updated_at
       FROM organization_memberships m
       JOIN organization_accounts a ON a.id = m.account_id
       WHERE m.organization_id = ? AND m.disabled_at IS NULL
       ORDER BY m.role_kind DESC, a.username_normalized`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      account_id: string;
      username: string;
      role_kind: string;
      capabilities_json: string;
      created_at: string;
      updated_at: string;
    }>();
  return json({
    members: rows.results.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      username: row.username,
      role: row.role_kind,
      capabilities: JSON.parse(row.capabilities_json) as unknown,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

async function removeOrganizationMember(
  request: Request,
  db: D1DatabaseLike,
  organizationId: string,
  membershipId: string,
) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  const result = await disableOrganizationMembership(db, organizationId, membershipId);
  if (result === "last_organizer") {
    return errorResponse(409, "last_organizer", "Der letzte aktive Organizer kann nicht deaktiviert werden.");
  }
  if (result === "not_found") {
    return errorResponse(404, "membership_not_found", "Organization-Mitglied wurde nicht gefunden.");
  }
  await audit(db, organizationId, auth.session.accountId, "membership.disable", "membership", membershipId);
  return json({ ok: true });
}

export async function handleOrganizationApi(request: Request, env: OrganizationApiEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const isOrganizationPath =
    url.pathname.startsWith("/api/organization/") ||
    url.pathname === "/api/organizations" ||
    url.pathname.startsWith("/api/organizations/");
  if (!isOrganizationPath) return null;
  if (!sameOriginWrite(request)) {
    return errorResponse(403, "origin_forbidden", "Organization-Schreibzugriffe benötigen denselben Origin.");
  }
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");
  const db = env.DB;
  if (!(await hasOrganizationSchema(db))) {
    return errorResponse(503, "organization_schema_unavailable", "Organization-Plattform benötigt Migration 0018.");
  }

  if (url.pathname === "/api/organization/bootstrap" && request.method === "POST") {
    if (!env.ORGANIZATION_BOOTSTRAP_SECRET || !env.ORGANIZATION_TOTP_KEY) {
      return errorResponse(503, "organization_bootstrap_unconfigured", "Organization-Bootstrap ist nicht konfiguriert.");
    }
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const submittedSecret = typeof parsed.value.bootstrapSecret === "string" ? parsed.value.bootstrapSecret : "";
    if (!(await organizationBootstrapSecretMatches(submittedSecret, env.ORGANIZATION_BOOTSTRAP_SECRET))) {
      return errorResponse(403, "bootstrap_forbidden", "Bootstrap ist nicht autorisiert.");
    }
    const result = await bootstrapOrganization(db, {
      organizationName: parsed.value.organizationName,
      username: parsed.value.username,
      password: parsed.value.password,
      totpKey: env.ORGANIZATION_TOTP_KEY,
    });
    if (!result.ok) {
      return errorResponse(
        result.code === "bootstrap_unavailable" ? 409 : 400,
        result.code,
        result.code === "bootstrap_unavailable"
          ? "Organization-Bootstrap wurde bereits beansprucht oder konnte nicht atomar abgeschlossen werden."
          : "Organization-, Benutzer- oder Passwortdaten sind ungültig.",
      );
    }
    const response = json({
      organization: result.organization,
      account: result.account,
      otpauthUri: result.otpauthUri,
      recoveryCodes: result.recoveryCodes,
      challengeExpiresAt: result.challengeExpiresAt,
    }, { status: 201 });
    return appendCookie(response, organizationLoginChallengeCookie(result.challengeSecret));
  }

  if (url.pathname === "/api/organization/login/password" && request.method === "POST") {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const normalized = normalizeOrganizationUsername(parsed.value.username)?.normalized ?? "invalid";
    if (env.ORGANIZATION_LOGIN_LIMITER) {
      const actor = request.headers.get("cf-connecting-ip") ?? "unknown";
      const limited = await env.ORGANIZATION_LOGIN_LIMITER.limit({ key: `${actor}:${normalized}` });
      if (!limited.success) {
        return errorResponse(429, "login_throttled", "Anmeldung ist vorübergehend nicht möglich.");
      }
    }
    const result = await beginOrganizationPasswordLogin(db, {
      username: parsed.value.username,
      password: parsed.value.password,
    });
    if (!result.ok) {
      return errorResponse(
        result.code === "throttled" ? 429 : 401,
        "invalid_credentials",
        "Benutzername oder Passwort ist ungültig.",
      );
    }
    const response = json({ challengeExpiresAt: result.challengeExpiresAt, requiresFactor: true });
    return appendCookie(response, organizationLoginChallengeCookie(result.challengeSecret));
  }

  if (url.pathname === "/api/organization/login/totp" && request.method === "POST") {
    if (!env.ORGANIZATION_TOTP_KEY) {
      return errorResponse(503, "organization_totp_unconfigured", "TOTP-Schlüssel ist nicht konfiguriert.");
    }
    const challengeSecret = cookieValue(request, LOGIN_CHALLENGE_COOKIE) ?? "";
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const result = await completeOrganizationTotpLogin(db, {
      challengeSecret,
      code: parsed.value.code,
      totpKey: env.ORGANIZATION_TOTP_KEY,
    });
    if (!result.ok) {
      return errorResponse(401, "invalid_factor", "Anmeldebestätigung ist ungültig oder abgelaufen.");
    }
    const response = json({ account: result.account, assurance: result.session.assurance });
    appendCookie(response, organizationAccountSessionCookie(result.session.secret));
    return appendCookie(response, clearOrganizationLoginChallengeCookie());
  }

  if (url.pathname === "/api/organization/login/recovery" && request.method === "POST") {
    const challengeSecret = cookieValue(request, LOGIN_CHALLENGE_COOKIE) ?? "";
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const result = await completeOrganizationRecoveryLogin(db, {
      challengeSecret,
      recoveryCode: parsed.value.recoveryCode,
    });
    if (!result.ok) {
      return errorResponse(401, "invalid_factor", "Recovery-Code ist ungültig oder abgelaufen.");
    }
    const response = json({
      account: result.account,
      assurance: result.session.assurance,
      requiresTotpReenrollment: true,
    });
    appendCookie(response, organizationAccountSessionCookie(result.session.secret));
    return appendCookie(response, clearOrganizationLoginChallengeCookie());
  }

  if (url.pathname === "/api/organization/logout" && request.method === "POST") {
    await revokeOrganizationAccountSession(db, request);
    const response = json({ ok: true });
    appendCookie(response, clearOrganizationAccountSessionCookie());
    return appendCookie(response, clearOrganizationLoginChallengeCookie());
  }

  if (url.pathname === "/api/organization/me" && request.method === "GET") {
    const session = await resolveOrganizationAccountSession(db, request);
    if (!session) return errorResponse(401, "authentication_required", "Organization-Anmeldung ist erforderlich.");
    return json({
      account: { id: session.accountId, username: session.username },
      assurance: session.assurance,
      memberships: await listOrganizationMemberships(db, session.accountId),
    });
  }

  if (url.pathname === "/api/organizations") {
    if (request.method === "GET") {
      const session = await resolveOrganizationAccountSession(db, request);
      if (!session) return errorResponse(401, "authentication_required", "Organization-Anmeldung ist erforderlich.");
      return json({ organizations: await listOrganizationMemberships(db, session.accountId) });
    }
    if (request.method === "POST") return createOrganization(request, db);
    return errorResponse(405, "method_not_allowed", "Organization-Methode nicht erlaubt.");
  }

  const campaignRoute = organizationCampaignRoute(url.pathname);
  if (campaignRoute) {
    if (!campaignRoute.campaignId && request.method === "GET") {
      return listOrganizationCampaigns(request, db, campaignRoute.organizationId);
    }
    if (!campaignRoute.campaignId && request.method === "POST") {
      return createOrganizationCampaign(request, db, campaignRoute.organizationId);
    }
    if (campaignRoute.campaignId && request.method === "PATCH") {
      return updateOrganizationCampaign(request, db, campaignRoute.organizationId, campaignRoute.campaignId);
    }
    return errorResponse(405, "method_not_allowed", "Aktionsmethode nicht erlaubt.");
  }

  const memberRoute = organizationMemberRoute(url.pathname);
  if (memberRoute) {
    if (!memberRoute.membershipId && request.method === "GET") {
      return listOrganizationMembers(request, db, memberRoute.organizationId);
    }
    if (memberRoute.membershipId && request.method === "DELETE") {
      return removeOrganizationMember(request, db, memberRoute.organizationId, memberRoute.membershipId);
    }
    return errorResponse(405, "method_not_allowed", "Mitglieder-Methode nicht erlaubt.");
  }

  return errorResponse(404, "not_found", "Organization-Route wurde nicht gefunden.");
}

export const ORGANIZER_ADMIN_REQUIRED_CAPABILITIES: readonly OrganizationCapability[] = [
  "organization.manage",
  "account.manage",
  "role.manage",
  "campaign.create",
  "campaign.manage",
  "campaign.delete",
  "team.cross_manage",
  "audit.read",
  "security.manage",
];
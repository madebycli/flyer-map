import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  clearOrganizationAccountSessionCookie,
  organizationLoginChallengeCookie,
  requireOrganizationCapability,
  resolveOrganizationAccountSession,
  resolveOrganizationMembership,
  type OrganizationCapability,
  type OrganizationMembershipRole,
} from "./organizationAuth.ts";
import type { OrganizationApiEnv } from "./organizationApi.ts";
import {
  changeOrganizationPassword,
  changeOrganizationUsername,
  createOrganizationInvite,
  createOrganizationPasswordReset,
  hasFreshOrganizationMfa,
  listOrganizationAccountSessions,
  parseOrganizationCapabilities,
  redeemOrganizationInvite,
  redeemOrganizationPasswordReset,
  restartOrganizationTotpEnrollment,
  revokeOrganizationAccountSessionById,
  rotateOrganizationRecoveryCodes,
} from "./organizationSecurity.ts";

const MAX_BODY_BYTES = 96_000;
const SELECTOR_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const FEATURE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

export type OrganizationSecurityApiEnv = OrganizationApiEnv;

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
  return request.headers.get("origin") === new URL(request.url).origin;
}

function selector(value: string) {
  return SELECTOR_PATTERN.test(value) ? value : null;
}

function decodeSelector(value: string | undefined) {
  if (!value) return null;
  try {
    return selector(decodeURIComponent(value));
  } catch {
    return null;
  }
}

async function hasSecuritySchema(db: D1DatabaseLike) {
  try {
    const tables = await Promise.all([
      db.prepare("PRAGMA table_info(organization_invite_claims)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(organization_password_resets)").all<{ name: string }>(),
      db.prepare("PRAGMA table_info(organization_feature_settings)").all<{ name: string }>(),
    ]);
    return tables.every((table) => table.results.length > 0);
  } catch {
    return false;
  }
}

function authError(code: string) {
  if (code === "authentication_required") return errorResponse(401, code, "Organization-Anmeldung ist erforderlich.");
  if (code === "mfa_required") return errorResponse(403, code, "Für diese Aktion ist MFA erforderlich.");
  return errorResponse(403, "forbidden", "Diese Organization-Berechtigung fehlt.");
}

async function audit(
  db: D1DatabaseLike,
  organizationId: string,
  actorAccountId: string,
  eventType: string,
  targetType: string,
  targetId: string,
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

function organizationSecurityRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/organizations\/([^/]+)\/(invites|roles|audit|features|password-resets)(?:\/([^/]+))?$/u,
  );
  if (!match) return null;
  const organizationId = decodeSelector(match[1]);
  const resourceId = decodeSelector(match[3]);
  return organizationId
    ? { organizationId, resource: match[2] as "invites" | "roles" | "audit" | "features" | "password-resets", resourceId }
    : null;
}

function sessionRoute(pathname: string) {
  const match = pathname.match(/^\/api\/organization\/sessions(?:\/([^/]+))?$/u);
  if (!match) return null;
  return { sessionId: decodeSelector(match[1]) };
}

async function requireSelfMembership(request: Request, db: D1DatabaseLike, organizationId: string) {
  const session = await resolveOrganizationAccountSession(db, request);
  if (!session) return { ok: false as const, response: authError("authentication_required") };
  const membership = await resolveOrganizationMembership(db, session.accountId, organizationId);
  if (!membership) return { ok: false as const, response: authError("forbidden") };
  return { ok: true as const, session, membership };
}

async function handlePublicRedeem(request: Request, env: OrganizationSecurityApiEnv) {
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");
  if (!(await hasSecuritySchema(env.DB))) {
    return errorResponse(503, "organization_security_schema_unavailable", "Organization-Security benötigt Migration 0019.");
  }
  if (request.url.endsWith("/api/organization/invites/redeem")) {
    if (!env.ORGANIZATION_TOTP_KEY) {
      return errorResponse(503, "organization_totp_unconfigured", "TOTP-Schlüssel ist nicht konfiguriert.");
    }
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const result = await redeemOrganizationInvite(env.DB, {
      inviteSecret: parsed.value.inviteSecret,
      username: parsed.value.username,
      password: parsed.value.password,
      totpKey: env.ORGANIZATION_TOTP_KEY,
    });
    if (!result.ok) {
      return errorResponse(
        result.code === "invalid_invite_setup" ? 400 : 409,
        result.code,
        result.code === "invalid_invite_setup"
          ? "Einladungs-, Benutzer- oder Passwortdaten sind ungültig."
          : "Diese Einladung ist ungültig, abgelaufen, widerrufen oder bereits verwendet.",
      );
    }
    const response = json({
      organization: result.organization,
      account: result.account,
      membership: result.membership,
      otpauthUri: result.otpauthUri,
      recoveryCodes: result.recoveryCodes,
      challengeExpiresAt: result.challengeExpiresAt,
    }, { status: 201 });
    response.headers.append("set-cookie", organizationLoginChallengeCookie(result.challengeSecret));
    return response;
  }

  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const result = await redeemOrganizationPasswordReset(env.DB, {
    resetSecret: parsed.value.resetSecret,
    password: parsed.value.password,
  });
  if (!result.ok) {
    return errorResponse(
      result.code === "invalid_reset" ? 400 : 409,
      result.code,
      result.code === "invalid_reset"
        ? "Reset-Daten sind ungültig."
        : "Dieser Passwort-Reset ist ungültig, abgelaufen, widerrufen oder bereits verwendet.",
    );
  }
  const response = json({ ok: true });
  response.headers.append("set-cookie", clearOrganizationAccountSessionCookie());
  return response;
}

async function handleSelfSecurity(request: Request, env: OrganizationSecurityApiEnv) {
  const db = env.DB!;
  if (request.url.endsWith("/api/organization/security/password")) {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const organizationId = typeof parsed.value.organizationId === "string" ? selector(parsed.value.organizationId) : null;
    if (!organizationId) return errorResponse(400, "invalid_organization", "Organization ist ungültig.");
    const auth = await requireSelfMembership(request, db, organizationId);
    if (!auth.ok) return auth.response;
    if (auth.session.assurance !== "mfa") return authError("mfa_required");
    const result = await changeOrganizationPassword(db, {
      organizationId,
      accountId: auth.session.accountId,
      currentPassword: parsed.value.currentPassword,
      nextPassword: parsed.value.nextPassword,
    });
    if (!result.ok) {
      return errorResponse(
        result.code === "invalid_credentials" ? 401 : 400,
        result.code,
        result.code === "invalid_credentials" ? "Aktuelles Passwort ist ungültig." : "Neues Passwort ist ungültig.",
      );
    }
    const response = json({ ok: true, requiresLogin: true });
    response.headers.append("set-cookie", clearOrganizationAccountSessionCookie());
    return response;
  }

  if (request.url.endsWith("/api/organization/security/username")) {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const organizationId = typeof parsed.value.organizationId === "string" ? selector(parsed.value.organizationId) : null;
    if (!organizationId) return errorResponse(400, "invalid_organization", "Organization ist ungültig.");
    const auth = await requireSelfMembership(request, db, organizationId);
    if (!auth.ok) return auth.response;
    if (auth.session.assurance !== "mfa") return authError("mfa_required");
    const result = await changeOrganizationUsername(db, {
      organizationId,
      accountId: auth.session.accountId,
      currentPassword: parsed.value.currentPassword,
      username: parsed.value.username,
    });
    if (!result.ok) {
      return errorResponse(
        result.code === "invalid_credentials" ? 401 : result.code === "username_unavailable" ? 409 : 400,
        result.code,
        result.code === "invalid_credentials"
          ? "Aktuelles Passwort ist ungültig."
          : result.code === "username_unavailable"
            ? "Dieser Benutzername ist bereits vergeben."
            : "Benutzername ist ungültig.",
      );
    }
    return json({ ok: true, username: result.username });
  }

  if (request.url.endsWith("/api/organization/security/recovery-codes")) {
    const parsed = await readBody(request);
    if (!parsed.ok) return parsed.response;
    const organizationId = typeof parsed.value.organizationId === "string" ? selector(parsed.value.organizationId) : null;
    if (!organizationId) return errorResponse(400, "invalid_organization", "Organization ist ungültig.");
    const auth = await requireSelfMembership(request, db, organizationId);
    if (!auth.ok) return auth.response;
    if (auth.session.assurance !== "mfa") return authError("mfa_required");
    const result = await rotateOrganizationRecoveryCodes(db, {
      organizationId,
      accountId: auth.session.accountId,
      currentPassword: parsed.value.currentPassword,
    });
    if (!result.ok) return errorResponse(401, result.code, "Aktuelles Passwort ist ungültig.");
    return json({ recoveryCodes: result.recoveryCodes });
  }

  if (!env.ORGANIZATION_TOTP_KEY) {
    return errorResponse(503, "organization_totp_unconfigured", "TOTP-Schlüssel ist nicht konfiguriert.");
  }
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const organizationId = typeof parsed.value.organizationId === "string" ? selector(parsed.value.organizationId) : null;
  if (!organizationId) return errorResponse(400, "invalid_organization", "Organization ist ungültig.");
  const auth = await requireSelfMembership(request, db, organizationId);
  if (!auth.ok) return auth.response;
  const result = await restartOrganizationTotpEnrollment(db, {
    organizationId,
    accountId: auth.session.accountId,
    username: auth.session.username,
    currentPassword: parsed.value.currentPassword,
    totpKey: env.ORGANIZATION_TOTP_KEY,
  });
  if (!result.ok) return errorResponse(401, result.code, "Aktuelles Passwort ist ungültig.");
  const response = json({
    otpauthUri: result.otpauthUri,
    recoveryCodes: result.recoveryCodes,
    challengeExpiresAt: result.challengeExpiresAt,
    requiresFactor: true,
  });
  response.headers.append("set-cookie", organizationLoginChallengeCookie(result.challengeSecret));
  response.headers.append("set-cookie", clearOrganizationAccountSessionCookie());
  return response;
}

async function listInvites(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT id, role_kind, capabilities_json, created_at, expires_at, used_at, revoked_at
       FROM organization_invites WHERE organization_id = ? ORDER BY created_at DESC, id`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      role_kind: OrganizationMembershipRole;
      capabilities_json: string;
      created_at: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
    }>();
  return json({
    invites: rows.results.map((row) => ({
      id: row.id,
      role: row.role_kind,
      capabilities: parseOrganizationCapabilities(JSON.parse(row.capabilities_json) as unknown) ?? [],
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      revokedAt: row.revoked_at,
    })),
  });
}

async function createInvite(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const role = parsed.value.role === "organizer" || parsed.value.role === "admin" ? parsed.value.role : null;
  const capabilities = parseOrganizationCapabilities(parsed.value.capabilities ?? []);
  if (!role || !capabilities) return errorResponse(400, "invalid_invite", "Rolle oder Berechtigungen sind ungültig.");
  if (role === "organizer") {
    if (auth.membership.role !== "organizer") return authError("forbidden");
    if (!(await hasFreshOrganizationMfa(db, request))) {
      return errorResponse(403, "fresh_mfa_required", "Organizer-Einladungen benötigen eine Anmeldung der letzten 10 Minuten.");
    }
  }
  const expiresInHours = typeof parsed.value.expiresInHours === "number" ? parsed.value.expiresInHours : undefined;
  const invite = await createOrganizationInvite(db, {
    organizationId,
    actorAccountId: auth.session.accountId,
    role,
    capabilities,
    expiresInHours,
  });
  await audit(db, organizationId, auth.session.accountId, "invite.create", "invite", invite.id, { role });
  return json({ invite: { id: invite.id, role, capabilities: invite.capabilities, expiresAt: invite.expiresAt }, secret: invite.secret }, { status: 201 });
}

async function revokeInvite(request: Request, db: D1DatabaseLike, organizationId: string, inviteId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  const now = new Date().toISOString();
  const result = await db.batch([
    db
      .prepare(
        `UPDATE organization_invites SET revoked_at = ?
         WHERE id = ? AND organization_id = ? AND used_at IS NULL AND revoked_at IS NULL`,
      )
      .bind(now, inviteId, organizationId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) return errorResponse(404, "invite_not_found", "Aktive Einladung wurde nicht gefunden.");
  await audit(db, organizationId, auth.session.accountId, "invite.revoke", "invite", inviteId);
  return json({ ok: true });
}

async function listRoles(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "role.manage");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT id, name, capabilities_json, created_at, updated_at
       FROM organization_role_templates WHERE organization_id = ? ORDER BY name, id`,
    )
    .bind(organizationId)
    .all<{ id: string; name: string; capabilities_json: string; created_at: string; updated_at: string }>();
  return json({
    roles: rows.results.map((row) => ({
      id: row.id,
      name: row.name,
      capabilities: parseOrganizationCapabilities(JSON.parse(row.capabilities_json) as unknown) ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  });
}

async function createRole(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "role.manage");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  const capabilities = parseOrganizationCapabilities(parsed.value.capabilities);
  if (name.length < 2 || name.length > 80 || !capabilities) {
    return errorResponse(400, "invalid_role", "Rollenname oder Berechtigungen sind ungültig.");
  }
  const id = `org_role_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  try {
    const result = await db.batch([
      db
        .prepare(
          `INSERT INTO organization_role_templates
            (id, organization_id, name, capabilities_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, organizationId, name, JSON.stringify(capabilities), now, now),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1) throw new Error("role_create_failed");
  } catch {
    return errorResponse(409, "role_name_unavailable", "Eine Rolle mit diesem Namen existiert bereits.");
  }
  await audit(db, organizationId, auth.session.accountId, "role.create", "role", id, { name, capabilities });
  return json({ role: { id, name, capabilities } }, { status: 201 });
}

async function updateRole(request: Request, db: D1DatabaseLike, organizationId: string, roleId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "role.manage");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const name = typeof parsed.value.name === "string" ? parsed.value.name.trim() : "";
  const capabilities = parseOrganizationCapabilities(parsed.value.capabilities);
  if (name.length < 2 || name.length > 80 || !capabilities) {
    return errorResponse(400, "invalid_role", "Rollenname oder Berechtigungen sind ungültig.");
  }
  const now = new Date().toISOString();
  try {
    const result = await db.batch([
      db
        .prepare(
          `UPDATE organization_role_templates
           SET name = ?, capabilities_json = ?, updated_at = ?
           WHERE id = ? AND organization_id = ?`,
        )
        .bind(name, JSON.stringify(capabilities), now, roleId, organizationId),
    ]);
    if ((result[0]?.meta?.changes ?? 0) !== 1) return errorResponse(404, "role_not_found", "Rolle wurde nicht gefunden.");
  } catch {
    return errorResponse(409, "role_name_unavailable", "Eine Rolle mit diesem Namen existiert bereits.");
  }
  await audit(db, organizationId, auth.session.accountId, "role.update", "role", roleId, { name, capabilities });
  return json({ role: { id: roleId, name, capabilities } });
}

async function deleteRole(request: Request, db: D1DatabaseLike, organizationId: string, roleId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "role.manage");
  if (!auth.ok) return authError(auth.code);
  const result = await db.batch([
    db.prepare("DELETE FROM organization_role_templates WHERE id = ? AND organization_id = ?").bind(roleId, organizationId),
  ]);
  if ((result[0]?.meta?.changes ?? 0) !== 1) return errorResponse(404, "role_not_found", "Rolle wurde nicht gefunden.");
  await audit(db, organizationId, auth.session.accountId, "role.delete", "role", roleId);
  return json({ ok: true });
}

async function listAudit(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "audit.read");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT id, actor_account_id, event_type, target_type, target_id, details_json, created_at
       FROM organization_audit_events
       WHERE organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`,
    )
    .bind(organizationId)
    .all<{
      id: string;
      actor_account_id: string | null;
      event_type: string;
      target_type: string | null;
      target_id: string | null;
      details_json: string;
      created_at: string;
    }>();
  return json({
    events: rows.results.map((row) => ({
      id: row.id,
      actorAccountId: row.actor_account_id,
      type: row.event_type,
      targetType: row.target_type,
      targetId: row.target_id,
      details: JSON.parse(row.details_json) as unknown,
      createdAt: row.created_at,
    })),
  });
}

async function listFeatures(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "organization.manage");
  if (!auth.ok) return authError(auth.code);
  const rows = await db
    .prepare(
      `SELECT feature_key, enabled, updated_at
       FROM organization_feature_settings WHERE organization_id = ? ORDER BY feature_key`,
    )
    .bind(organizationId)
    .all<{ feature_key: string; enabled: number; updated_at: string }>();
  return json({ features: rows.results.map((row) => ({ key: row.feature_key, enabled: row.enabled === 1, updatedAt: row.updated_at })) });
}

async function updateFeature(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "organization.manage");
  if (!auth.ok) return authError(auth.code);
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const key = typeof parsed.value.key === "string" ? parsed.value.key.trim() : "";
  const enabled = parsed.value.enabled;
  if (!FEATURE_KEY_PATTERN.test(key) || typeof enabled !== "boolean") {
    return errorResponse(400, "invalid_feature", "Feature-Key oder Status ist ungültig.");
  }
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO organization_feature_settings
          (organization_id, feature_key, enabled, updated_by_account_id, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(organization_id, feature_key) DO UPDATE SET
           enabled = excluded.enabled,
           updated_by_account_id = excluded.updated_by_account_id,
           updated_at = excluded.updated_at`,
      )
      .bind(organizationId, key, enabled ? 1 : 0, auth.session.accountId, now),
  ]);
  await audit(db, organizationId, auth.session.accountId, "feature.update", "feature", key, { enabled });
  return json({ feature: { key, enabled, updatedAt: now } });
}

async function createPasswordReset(request: Request, db: D1DatabaseLike, organizationId: string) {
  const auth = await requireOrganizationCapability(db, request, organizationId, "account.manage");
  if (!auth.ok) return authError(auth.code);
  if (!(await hasFreshOrganizationMfa(db, request))) {
    return errorResponse(403, "fresh_mfa_required", "Passwort-Resets benötigen eine Anmeldung der letzten 10 Minuten.");
  }
  const parsed = await readBody(request);
  if (!parsed.ok) return parsed.response;
  const targetAccountId = typeof parsed.value.accountId === "string" ? selector(parsed.value.accountId) : null;
  if (!targetAccountId) return errorResponse(400, "invalid_account", "Account ist ungültig.");
  const targetMembership = await resolveOrganizationMembership(db, targetAccountId, organizationId);
  if (!targetMembership) return errorResponse(404, "account_not_found", "Account wurde in dieser Organization nicht gefunden.");
  if (targetMembership.role === "organizer" && auth.membership.role !== "organizer") return authError("forbidden");
  const reset = await createOrganizationPasswordReset(db, {
    organizationId,
    targetAccountId,
    actorAccountId: auth.session.accountId,
    expiresInMinutes: typeof parsed.value.expiresInMinutes === "number" ? parsed.value.expiresInMinutes : undefined,
  });
  if (!reset.ok) return errorResponse(404, reset.code, "Account wurde nicht gefunden.");
  await audit(db, organizationId, auth.session.accountId, "account.password_reset_create", "account", targetAccountId);
  return json({ reset: { id: reset.id, expiresAt: reset.expiresAt }, secret: reset.secret }, { status: 201 });
}

export async function handleOrganizationSecurityApi(
  request: Request,
  env: OrganizationSecurityApiEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const publicRedeem =
    url.pathname === "/api/organization/invites/redeem" ||
    url.pathname === "/api/organization/password-reset/redeem";
  const selfSecurity =
    url.pathname === "/api/organization/security/password" ||
    url.pathname === "/api/organization/security/username" ||
    url.pathname === "/api/organization/security/recovery-codes" ||
    url.pathname === "/api/organization/security/totp/restart";
  const sessions = sessionRoute(url.pathname);
  const organizationRoute = organizationSecurityRoute(url.pathname);
  if (!publicRedeem && !selfSecurity && !sessions && !organizationRoute) return null;
  if (!sameOriginWrite(request)) return errorResponse(403, "origin_forbidden", "Organization-Schreibzugriffe benötigen denselben Origin.");
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");
  if (!(await hasSecuritySchema(env.DB))) {
    return errorResponse(503, "organization_security_schema_unavailable", "Organization-Security benötigt Migration 0019.");
  }
  if (publicRedeem) {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Redeem-Methode nicht erlaubt.");
    return handlePublicRedeem(request, env);
  }
  if (selfSecurity) {
    if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Security-Methode nicht erlaubt.");
    return handleSelfSecurity(request, env);
  }
  if (sessions) {
    const session = await resolveOrganizationAccountSession(env.DB, request);
    if (!session) return authError("authentication_required");
    if (!sessions.sessionId && request.method === "GET") {
      return json({ sessions: await listOrganizationAccountSessions(env.DB, session.accountId, request) });
    }
    if (sessions.sessionId && request.method === "DELETE") {
      const revoked = await revokeOrganizationAccountSessionById(env.DB, session.accountId, sessions.sessionId);
      return revoked ? json({ ok: true }) : errorResponse(404, "session_not_found", "Sitzung wurde nicht gefunden.");
    }
    return errorResponse(405, "method_not_allowed", "Session-Methode nicht erlaubt.");
  }

  const route = organizationRoute!;
  if (route.resource === "invites") {
    if (!route.resourceId && request.method === "GET") return listInvites(request, env.DB, route.organizationId);
    if (!route.resourceId && request.method === "POST") return createInvite(request, env.DB, route.organizationId);
    if (route.resourceId && request.method === "DELETE") return revokeInvite(request, env.DB, route.organizationId, route.resourceId);
  }
  if (route.resource === "roles") {
    if (!route.resourceId && request.method === "GET") return listRoles(request, env.DB, route.organizationId);
    if (!route.resourceId && request.method === "POST") return createRole(request, env.DB, route.organizationId);
    if (route.resourceId && request.method === "PATCH") return updateRole(request, env.DB, route.organizationId, route.resourceId);
    if (route.resourceId && request.method === "DELETE") return deleteRole(request, env.DB, route.organizationId, route.resourceId);
  }
  if (route.resource === "audit" && !route.resourceId && request.method === "GET") {
    return listAudit(request, env.DB, route.organizationId);
  }
  if (route.resource === "features" && !route.resourceId) {
    if (request.method === "GET") return listFeatures(request, env.DB, route.organizationId);
    if (request.method === "PUT") return updateFeature(request, env.DB, route.organizationId);
  }
  if (route.resource === "password-resets" && !route.resourceId && request.method === "POST") {
    return createPasswordReset(request, env.DB, route.organizationId);
  }
  return errorResponse(405, "method_not_allowed", "Organization-Security-Methode nicht erlaubt.");
}

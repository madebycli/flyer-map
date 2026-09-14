import { hashSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { resolveOrganizationAccountSession } from "./organizationAuth.ts";
import { revokeTrustedDevicesForSubject, type TrustedDeviceSubjectKind } from "./trustedDevice.ts";

type Subject = { kind: TrustedDeviceSubjectKind; id: string };

const SELECTOR = /^[A-Za-z0-9._:-]{1,200}$/u;

function decodeSelector(value: string | undefined) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return SELECTOR.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function bodyRecord(request: Request) {
  try {
    const value = await request.json() as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function organizationSelfSubject(request: Request, db: D1DatabaseLike) {
  const session = await resolveOrganizationAccountSession(db, request);
  return session ? { kind: "organization_account" as const, id: session.accountId } : null;
}

async function organizationResetSubject(request: Request, db: D1DatabaseLike) {
  const body = await bodyRecord(request);
  const secret = typeof body?.resetSecret === "string" && body.resetSecret.length <= 256 ? body.resetSecret : null;
  if (!secret) return null;
  const tokenHash = await hashSecret(secret);
  const row = await db.prepare(
    `SELECT account_id FROM organization_password_resets
     WHERE token_hash = ? LIMIT 1`,
  ).bind(tokenHash).first<{ account_id: string }>();
  return row ? { kind: "organization_account" as const, id: row.account_id } : null;
}

async function organizationMembershipSubject(pathname: string, db: D1DatabaseLike) {
  const match = pathname.match(/^\/api\/organizations\/([^/]+)\/members\/([^/]+)$/u);
  if (!match) return null;
  const organizationId = decodeSelector(match[1]);
  const membershipId = decodeSelector(match[2]);
  if (!organizationId || !membershipId) return null;
  const row = await db.prepare(
    `SELECT account_id FROM organization_memberships
     WHERE id = ? AND organization_id = ? LIMIT 1`,
  ).bind(membershipId, organizationId).first<{ account_id: string }>();
  return row ? { kind: "organization_account" as const, id: row.account_id } : null;
}

async function campaignAdminResetSubject(request: Request, db: D1DatabaseLike) {
  const body = await bodyRecord(request);
  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : null;
  const secret = typeof body?.token === "string" && body.token.length <= 256 ? body.token : null;
  if (!campaignId || !secret) return null;
  const tokenHash = await hashSecret(secret);
  const row = await db.prepare(
    `SELECT account_id FROM campaign_admin_password_reset_invites
     WHERE campaign_id = ? AND token_hash = ? LIMIT 1`,
  ).bind(campaignId, tokenHash).first<{ account_id: string }>();
  return row ? { kind: "campaign_admin" as const, id: row.account_id } : null;
}

function campaignAdminAccountSubject(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/admin-accounts\/([^/]+)$/u);
  if (!match) return null;
  const accountId = decodeSelector(match[2]);
  return accountId ? { kind: "campaign_admin" as const, id: accountId } : null;
}

/**
 * Capture the affected subject before the mutation runs. Password changes and
 * resets intentionally revoke the current short session, so looking it up only
 * after the response would be too late.
 */
export async function captureTrustedDeviceInvalidations(
  request: Request,
  db?: D1DatabaseLike,
): Promise<Subject[]> {
  if (!db) return [];
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (request.method !== "POST" && request.method !== "PATCH" && request.method !== "DELETE") return [];

  if (
    request.method === "POST" &&
    [
      "/api/organization/security/password",
      "/api/organization/security/username",
      "/api/organization/security/totp/restart",
      "/api/organization/security/mfa",
    ].includes(pathname)
  ) {
    const subject = await organizationSelfSubject(request, db);
    return subject ? [subject] : [];
  }

  if (request.method === "POST" && pathname === "/api/organization/password-reset/redeem") {
    const subject = await organizationResetSubject(request, db);
    return subject ? [subject] : [];
  }

  if (request.method === "DELETE" && /^\/api\/organizations\/[^/]+\/members\/[^/]+$/u.test(pathname)) {
    const subject = await organizationMembershipSubject(pathname, db);
    return subject ? [subject] : [];
  }

  if (request.method === "POST" && pathname === "/api/admin-accounts/password-reset") {
    const subject = await campaignAdminResetSubject(request, db);
    return subject ? [subject] : [];
  }

  if (
    (request.method === "DELETE" || request.method === "PATCH") &&
    /^\/api\/campaigns\/[^/]+\/admin-accounts\/[^/]+$/u.test(pathname)
  ) {
    const subject = campaignAdminAccountSubject(pathname);
    return subject ? [subject] : [];
  }

  return [];
}

export async function applyTrustedDeviceInvalidations(
  db: D1DatabaseLike | undefined,
  subjects: readonly Subject[],
  response: Response,
) {
  if (!db || !response.ok || subjects.length === 0) return response;
  for (const subject of subjects) {
    await revokeTrustedDevicesForSubject(db, subject.kind, subject.id);
  }
  return response;
}

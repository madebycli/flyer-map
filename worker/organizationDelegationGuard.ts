import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  resolveOrganizationAccountSession,
  resolveOrganizationMembership,
  type OrganizationCapability,
  type OrganizationMembershipRole,
} from "./organizationAuth.ts";
import { parseOrganizationCapabilities } from "./organizationSecurity.ts";

const SELECTOR_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;

type DelegationDecision =
  | { ok: true }
  | { ok: false; code: "organizer_only" | "capability_escalation" };

export function canDelegateOrganizationAccess(
  actorRole: OrganizationMembershipRole,
  actorCapabilities: readonly OrganizationCapability[],
  targetRole: OrganizationMembershipRole,
  targetCapabilities: readonly OrganizationCapability[],
): DelegationDecision {
  if (actorRole === "organizer") return { ok: true };
  if (targetRole === "organizer") return { ok: false, code: "organizer_only" };
  const allowed = new Set(actorCapabilities);
  return targetCapabilities.every((capability) => allowed.has(capability))
    ? { ok: true }
    : { ok: false, code: "capability_escalation" };
}

function jsonError(code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    {
      status: 403,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function decodeSelector(value: string | undefined) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    return SELECTOR_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function actorMembership(db: D1DatabaseLike, request: Request, organizationId: string) {
  const session = await resolveOrganizationAccountSession(db, request);
  if (!session || session.assurance !== "mfa") return null;
  return resolveOrganizationMembership(db, session.accountId, organizationId);
}

function forbidden(decision: Exclude<DelegationDecision, { ok: true }>) {
  return decision.code === "organizer_only"
    ? jsonError("organizer_only", "Nur Organizer dürfen Organizer-Rechte vergeben oder verwalten.")
    : jsonError(
        "capability_delegation_forbidden",
        "Admins dürfen nur Berechtigungen weitergeben, die sie selbst besitzen.",
      );
}

export async function guardOrganizationDelegationRequest(
  request: Request,
  db: D1DatabaseLike | undefined,
): Promise<Response | null> {
  if (!db) return null;
  const url = new URL(request.url);

  const security = url.pathname.match(
    /^\/api\/organizations\/([^/]+)\/(invites|roles)(?:\/([^/]+))?$/u,
  );
  if (security) {
    const organizationId = decodeSelector(security[1]);
    if (!organizationId) return null;
    const actor = await actorMembership(db, request, organizationId);
    if (!actor || actor.role === "organizer") return null;

    if (security[2] === "invites" && security[3] && request.method === "DELETE") {
      const inviteId = decodeSelector(security[3]);
      if (!inviteId) return null;
      const invite = await db
        .prepare("SELECT role_kind FROM organization_invites WHERE id = ? AND organization_id = ? LIMIT 1")
        .bind(inviteId, organizationId)
        .first<{ role_kind: OrganizationMembershipRole }>();
      return invite?.role_kind === "organizer"
        ? jsonError("organizer_only", "Nur Organizer dürfen Organizer-Einladungen widerrufen.")
        : null;
    }

    const mutatesCapabilities =
      (security[2] === "invites" && !security[3] && request.method === "POST") ||
      (security[2] === "roles" && !security[3] && request.method === "POST") ||
      (security[2] === "roles" && Boolean(security[3]) && request.method === "PATCH");
    if (!mutatesCapabilities) return null;

    let body: Record<string, unknown>;
    try {
      const parsed = await request.clone().json() as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      body = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    const capabilities = parseOrganizationCapabilities(body.capabilities);
    if (!capabilities) return null;
    const targetRole: OrganizationMembershipRole = security[2] === "invites" && body.role === "organizer"
      ? "organizer"
      : "admin";
    const decision = canDelegateOrganizationAccess(
      actor.role,
      actor.capabilities,
      targetRole,
      capabilities,
    );
    return decision.ok ? null : forbidden(decision);
  }

  const member = url.pathname.match(/^\/api\/organizations\/([^/]+)\/members\/([^/]+)$/u);
  if (member && request.method === "DELETE") {
    const organizationId = decodeSelector(member[1]);
    const membershipId = decodeSelector(member[2]);
    if (!organizationId || !membershipId) return null;
    const actor = await actorMembership(db, request, organizationId);
    if (!actor || actor.role === "organizer") return null;
    const target = await db
      .prepare("SELECT role_kind FROM organization_memberships WHERE id = ? AND organization_id = ? AND disabled_at IS NULL LIMIT 1")
      .bind(membershipId, organizationId)
      .first<{ role_kind: OrganizationMembershipRole }>();
    return target?.role_kind === "organizer"
      ? jsonError("organizer_only", "Admins dürfen Organizer-Mitgliedschaften nicht deaktivieren.")
      : null;
  }

  return null;
}

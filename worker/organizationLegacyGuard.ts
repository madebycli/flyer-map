import type { D1DatabaseLike } from "./campaignRepository.ts";
import { parseCampaignId } from "./snapshotValidation.ts";

const LEGACY_ADMIN_PATHS = new Set([
  "/api/admin/recover",
  "/api/admin/bootstrap",
  "/api/admin-accounts/setup",
  "/api/admin-accounts/password-reset",
]);

function errorResponse(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

async function campaignOrganizationId(db: D1DatabaseLike, campaignId: string) {
  try {
    const row = await db
      .prepare("SELECT organization_id FROM campaigns WHERE id = ? LIMIT 1")
      .bind(campaignId)
      .first<{ organization_id: string | null }>();
    return row?.organization_id ?? null;
  } catch {
    return null;
  }
}

async function bodyCampaignId(request: Request) {
  try {
    const value = await request.clone().json() as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const campaignId = (value as Record<string, unknown>).campaignId;
    return typeof campaignId === "string" ? parseCampaignId(campaignId) : null;
  } catch {
    return null;
  }
}

function campaignIdFromLegacyAccountPath(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/admin-accounts(?:\/|$)/u);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

function campaignIdFromAccessManagementPath(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/access$/u);
  if (!match) return null;
  try {
    return parseCampaignId(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export async function guardOrganizationManagedLegacyAdminRequest(
  request: Request,
  db: D1DatabaseLike | undefined,
): Promise<Response | null> {
  if (!db) return null;
  const url = new URL(request.url);

  if (url.pathname === "/api/campaigns" && request.method === "POST") {
    return errorResponse(
      409,
      "organization_campaign_create_required",
      "Neue Campaigns werden ausschließlich von einem Organizer über die zentrale Organization-Verwaltung angelegt.",
    );
  }

  let campaignId = campaignIdFromLegacyAccountPath(url.pathname);
  if (!campaignId && LEGACY_ADMIN_PATHS.has(url.pathname) && request.method === "POST") {
    campaignId = await bodyCampaignId(request);
  }
  if (campaignId && await campaignOrganizationId(db, campaignId)) {
    return errorResponse(
      409,
      "organization_identity_required",
      "Diese Campaign verwendet zentrale Organization-Konten. Kampagnenlokale Admin-Konten, Setup-Links und Recovery sind deaktiviert.",
    );
  }

  const accessCampaignId = campaignIdFromAccessManagementPath(url.pathname);
  if (accessCampaignId && request.method === "POST" && await campaignOrganizationId(db, accessCampaignId)) {
    try {
      const value = await request.clone().json() as unknown;
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).role === "admin"
      ) {
        return errorResponse(
          409,
          "organization_admin_invite_required",
          "Admin-Zugriff für Organization-Campaigns wird ausschließlich über zentrale Organization-Einladungen vergeben.",
        );
      }
    } catch {
      // Let the base API return its normal invalid-json response.
    }
  }

  return null;
}

export async function rewriteOrganizationManagedAccessResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  response: Response,
): Promise<Response> {
  if (!db) return response;
  const url = new URL(request.url);
  if (url.pathname !== "/api/access/current" || request.method !== "GET") return response;
  const campaignId = parseCampaignId(url.searchParams.get("campaign") ?? "");
  if (!campaignId || !(await campaignOrganizationId(db, campaignId))) return response;

  if (response.status === 401) {
    return errorResponse(
      401,
      "organization_access_required",
      "Für diese Campaign ist eine zentrale Organization-Anmeldung mit ausreichender Berechtigung erforderlich.",
    );
  }
  if (!response.ok) return response;

  try {
    const payload = await response.clone().json() as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response;
    const access = (payload as Record<string, unknown>).access;
    if (!access || typeof access !== "object" || Array.isArray(access)) return response;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return Response.json(
      {
        ...(payload as Record<string, unknown>),
        access: { ...(access as Record<string, unknown>), identityProvider: "organization" },
      },
      { status: response.status, statusText: response.statusText, headers },
    );
  } catch {
    return response;
  }
}
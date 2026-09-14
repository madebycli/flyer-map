import type { D1DatabaseLike } from "./campaignRepository.ts";
import { adminAccountSessionCookie } from "./adminAuth.ts";
import {
  campaignAdminAccountIdByUsername,
  campaignAdminRememberCookie,
  clearCampaignAdminRememberCookie,
  createCampaignAdminRememberedDevice,
  refreshCampaignAdminRememberedDevice,
  revokeCurrentCampaignAdminRememberedDevice,
} from "./campaignAdminTrustedDevice.ts";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...init.headers } });
}

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function decodeCampaign(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return CAMPAIGN_ID_PATTERN.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function refreshCampaignId(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/admin-accounts\/session\/refresh$/u);
  return match ? decodeCampaign(match[1]) : null;
}

function loginCampaignId(pathname: string) {
  const match = pathname.match(/^\/api\/campaigns\/([^/]+)\/admin-accounts\/login$/u);
  return match ? decodeCampaign(match[1]) : null;
}

async function readBody(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

export async function handleCampaignAdminRememberRoute(request: Request, db?: D1DatabaseLike): Promise<Response | null> {
  const campaignId = refreshCampaignId(new URL(request.url).pathname);
  if (!campaignId) return null;
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Session-Refresh verwendet POST.");
  if (!sameOrigin(request)) return errorResponse(403, "origin_forbidden", "Session-Refresh benötigt denselben Origin.");
  if (!db) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");

  const refreshed = await refreshCampaignAdminRememberedDevice(db, request, campaignId);
  if (!refreshed.ok) {
    if (refreshed.code === "rotated") {
      return errorResponse(409, "remembered_device_rotated", "Dieses Gerät wurde gerade in einem anderen Tab erneuert.");
    }
    const response = errorResponse(401, "remembered_device_invalid", "Das gemerkte Gerät ist abgelaufen oder wurde widerrufen.");
    response.headers.append("set-cookie", clearCampaignAdminRememberCookie());
    return response;
  }
  const response = json({
    ok: true,
    campaignId: refreshed.campaignId,
    account: { id: refreshed.accountId, username: refreshed.username },
  });
  response.headers.append("set-cookie", adminAccountSessionCookie(refreshed.session.sessionSecret));
  response.headers.append("set-cookie", campaignAdminRememberCookie(refreshed.rememberSecret));
  return response;
}

export async function augmentCampaignAdminRememberResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  response: Response,
) {
  if (!db) return response;
  const pathname = new URL(request.url).pathname;

  if ((pathname === "/api/admin-accounts/logout" || pathname === "/api/access/logout") && request.method === "POST") {
    await revokeCurrentCampaignAdminRememberedDevice(db, request);
    response.headers.append("set-cookie", clearCampaignAdminRememberCookie());
    return response;
  }

  const campaignId = loginCampaignId(pathname);
  if (!campaignId || request.method !== "POST" || !response.ok) return response;
  const body = await readBody(request);
  if (!body || body.rememberDevice !== true || typeof body.username !== "string") return response;
  const accountId = await campaignAdminAccountIdByUsername(db, campaignId, body.username);
  if (!accountId) return response;
  const remembered = await createCampaignAdminRememberedDevice(db, accountId);
  if (remembered) response.headers.append("set-cookie", campaignAdminRememberCookie(remembered.secret));
  return response;
}

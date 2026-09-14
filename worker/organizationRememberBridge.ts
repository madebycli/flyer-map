import type { D1DatabaseLike } from "./campaignRepository.ts";
import { organizationAccountSessionCookie } from "./organizationAuth.ts";
import {
  clearOrganizationRememberCookie,
  createOrganizationRememberedDevice,
  organizationRememberCookie,
  refreshOrganizationRememberedDevice,
  revokeCurrentOrganizationRememberedDevice,
} from "./organizationTrustedDevice.ts";

const NO_STORE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin === new URL(request.url).origin;
}

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { ...NO_STORE_HEADERS, ...init.headers } });
}

function errorResponse(status: number, code: string, message: string) {
  return json({ error: { code, message } }, { status });
}

async function rememberRequested(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    return body?.rememberDevice === true;
  } catch {
    return false;
  }
}

async function accountIdFromResponse(response: Response) {
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    const account = payload?.account && typeof payload.account === "object" && !Array.isArray(payload.account)
      ? payload.account as Record<string, unknown>
      : null;
    return typeof account?.id === "string" ? account.id : null;
  } catch {
    return null;
  }
}

export async function handleOrganizationRememberRoute(request: Request, db?: D1DatabaseLike): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/organization/session/refresh") return null;
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Session-Refresh verwendet POST.");
  if (!sameOrigin(request)) return errorResponse(403, "origin_forbidden", "Session-Refresh benötigt denselben Origin.");
  if (!db) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");

  const refreshed = await refreshOrganizationRememberedDevice(db, request);
  if (!refreshed.ok) {
    const response = errorResponse(401, "remembered_device_invalid", "Das gemerkte Gerät ist abgelaufen oder wurde widerrufen.");
    response.headers.append("set-cookie", clearOrganizationRememberCookie());
    return response;
  }
  const response = json({ ok: true, account: refreshed.account, assurance: refreshed.session.assurance });
  response.headers.append("set-cookie", organizationAccountSessionCookie(refreshed.session.secret));
  response.headers.append("set-cookie", organizationRememberCookie(refreshed.rememberSecret));
  return response;
}

export async function augmentOrganizationRememberResponse(
  request: Request,
  db: D1DatabaseLike | undefined,
  response: Response,
) {
  if (!db) return response;
  const pathname = new URL(request.url).pathname;

  if (pathname === "/api/organization/logout" && request.method === "POST") {
    await revokeCurrentOrganizationRememberedDevice(db, request);
    response.headers.append("set-cookie", clearOrganizationRememberCookie());
    return response;
  }

  const eligibleLogin =
    pathname === "/api/organization/login/password" ||
    pathname === "/api/organization/login/totp";
  if (!eligibleLogin || request.method !== "POST" || !response.ok || !(await rememberRequested(request))) return response;

  const accountId = await accountIdFromResponse(response);
  if (!accountId) return response;
  const remembered = await createOrganizationRememberedDevice(db, accountId, "mfa");
  if (remembered) response.headers.append("set-cookie", organizationRememberCookie(remembered.secret));
  return response;
}

import { hashSecret } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import {
  bootstrapOrganization,
  organizationLoginChallengeCookie,
} from "./organizationAuth.ts";
import type { OrganizationApiEnv } from "./organizationApi.ts";

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const MAX_BODY_BYTES = 96_000;

export type OrganizationBootstrapHashEnv = OrganizationApiEnv & {
  ORGANIZATION_BOOTSTRAP_SECRET_SHA256?: string;
};

function constantTimeTextEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

export async function organizationBootstrapHashMatches(submitted: string, configuredSha256: string) {
  if (!submitted || !SHA256_HEX.test(configuredSha256)) return false;
  const submittedHash = await hashSecret(submitted);
  return constantTimeTextEqual(submittedHash, configuredSha256);
}

const json = (data: unknown, init: ResponseInit = {}) => Response.json(data, {
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

async function schemaAvailable(db: D1DatabaseLike) {
  try {
    const table = await db.prepare("PRAGMA table_info(organization_bootstrap_state)").all<{ name: string }>();
    return table.results.length > 0;
  } catch {
    return false;
  }
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function handleOrganizationBootstrapHashApi(
  request: Request,
  env: OrganizationBootstrapHashEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/organization/bootstrap" || !env.ORGANIZATION_BOOTSTRAP_SECRET_SHA256) return null;
  if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Bootstrap-Methode nicht erlaubt.");
  if (request.headers.get("origin") !== url.origin) {
    return errorResponse(403, "origin_forbidden", "Organization-Schreibzugriffe benötigen denselben Origin.");
  }
  if (!env.DB) return errorResponse(503, "d1_unavailable", "D1 ist nicht gebunden.");
  if (!env.ORGANIZATION_TOTP_KEY) {
    return errorResponse(503, "organization_bootstrap_unconfigured", "Organization-Bootstrap ist nicht vollständig konfiguriert.");
  }
  if (!(await schemaAvailable(env.DB))) {
    return errorResponse(503, "organization_schema_unavailable", "Organization-Plattform benötigt Migration 0018.");
  }
  const parsed = await readBody(request);
  if (!parsed) return errorResponse(400, "invalid_request", "Request-Daten sind ungültig.");
  const submittedSecret = typeof parsed.bootstrapSecret === "string" ? parsed.bootstrapSecret : "";
  if (!(await organizationBootstrapHashMatches(submittedSecret, env.ORGANIZATION_BOOTSTRAP_SECRET_SHA256))) {
    return errorResponse(403, "bootstrap_forbidden", "Bootstrap ist nicht autorisiert.");
  }
  const result = await bootstrapOrganization(env.DB, {
    organizationName: parsed.organizationName,
    username: parsed.username,
    password: parsed.password,
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
  response.headers.append("set-cookie", organizationLoginChallengeCookie(result.challengeSecret));
  return response;
}

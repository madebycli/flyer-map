import baseWorker from "./indexFc52.ts";
import { handleOrganizationApi, type OrganizationApiEnv } from "./organizationApi.ts";
import { failClosedOrganizationApiFallback, guardOrganizationApiMethod } from "./organizationApiFallback.ts";
import { handleOrganizationBootstrapHashApi, type OrganizationBootstrapHashEnv } from "./organizationBootstrapHashApi.ts";
import { configureOrganizationPasswordKdfRuntime, OrganizationPasswordKdfUnavailableError, type OrganizationPasswordKdfNamespace } from "./organizationPasswordKdf.ts";
import { handleOrganizationSecurityApi } from "./organizationSecurityApi.ts";
import { guardOrganizationSecurityQuery } from "./organizationSecurityRequest.ts";
import { guardOrganizationDelegationRequest } from "./organizationDelegationGuard.ts";
import { guardOrganizationManagedLegacyAdminRequest, rewriteOrganizationManagedAccessResponse } from "./organizationLegacyGuard.ts";
import { augmentOrganizationRememberResponse, handleOrganizationRememberRoute } from "./organizationRememberBridge.ts";
import { augmentCampaignAdminRememberResponse, handleCampaignAdminRememberRoute } from "./campaignAdminRememberBridge.ts";
import { applyTrustedDeviceInvalidations, captureTrustedDeviceInvalidations } from "./trustedDeviceInvalidation.ts";
import { handleOrganizationFieldGroupList, type OrganizationFieldGroupListEnv } from "./organizationFieldGroupList.ts";
import { handleTeamCommentsSummary, type TeamCommentsSummaryEnv } from "./teamCommentsSummary.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";

export { CampaignSyncDurableObject } from "./campaignSyncDurableObject.ts";
export { OrganizationPasswordKdfDurableObject } from "./organizationPasswordKdfDurableObject.ts";

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];
type Env = BaseEnv & OrganizationApiEnv & OrganizationBootstrapHashEnv & OrganizationFieldGroupListEnv & TeamCommentsSummaryEnv & {
  ORGANIZATION_PASSWORD_KDF?: OrganizationPasswordKdfNamespace;
  ORGANIZATION_KDF_DIAGNOSTICS?: string;
  RUNTIME_ENVIRONMENT?: string;
  SOURCE_COMMIT_SHA?: string;
  RELEASE_CHANNEL?: string;
  STREET_ENGINE_VERSION?: string;
  STREET_ENGINE_V4_CHANNEL?: string;
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
};

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/u;
type WorkerWebSocketResponse = Response & { webSocket?: unknown };
type WorkerWebSocketResponseInit = ResponseInit & { webSocket: unknown };

function harden(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("cross-origin-opener-policy", "same-origin");
  const webSocket = (response as WorkerWebSocketResponse).webSocket;
  if (webSocket) return new Response(null, { status: response.status, statusText: response.statusText, headers, webSocket, } as WorkerWebSocketResponseInit);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function redirectBareRootToOrganizationLogin(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;
  if (url.searchParams.has("workbench")) return null;
  const campaignId = url.searchParams.get("campaign");
  if (campaignId && CAMPAIGN_ID_PATTERN.test(campaignId)) return null;
  return Response.redirect(new URL("/login", url).toString(), 302);
}

function kdfUnavailableResponse(error: OrganizationPasswordKdfUnavailableError, diagnostics: boolean) {
  return harden(Response.json({ error: { code: "organization_password_kdf_unavailable", message: "Passwort-Ableitung ist vorübergehend nicht verfügbar.", ...(diagnostics ? { details: { reason: error.reason } } : {}) } }, { status: 503, headers: { "cache-control": "no-store" } }));
}

export default {
  async fetch(request: Request, env: Env, context?: AreaPreparationExecutionContext): Promise<Response> {
    configureOrganizationPasswordKdfRuntime(env.ORGANIZATION_PASSWORD_KDF);
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/runtime") {
        if (request.method !== "GET") return harden(new Response(request.method === "HEAD" ? null : JSON.stringify({ error: { code: "method_not_allowed", message: "Der Runtime-Vertrag verwendet GET." } }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", allow: "GET" } }));
        const streetEngineV4 = env.STREET_ENGINE_VERSION === "v4";
        return harden(Response.json({
          ok: true,
          version: env.CF_VERSION_METADATA?.id ?? "development",
          environment: env.RUNTIME_ENVIRONMENT ?? "development",
          sourceCommit: env.SOURCE_COMMIT_SHA ?? null,
          ...(streetEngineV4 ? {
            releaseChannel: env.RELEASE_CHANNEL ?? null,
            streetEngineVersion: "v4",
            streetEngineSourceChannel: env.STREET_ENGINE_V4_CHANNEL ?? null,
          } : {}),
          capabilities: {
            organizationAuth:true,
            organizationSecurity:true,
            campaignRuntime:true,
            rxdbSync:true,
            collection:true,
            fieldGroups:true,
            statistics:true,
            ...(streetEngineV4 ? { streetEngineV4:true } : {}),
          },
        }, { headers: { "cache-control": "no-store" } }));
      }
      const rootRedirect = redirectBareRootToOrganizationLogin(request); if (rootRedirect) return harden(rootRedirect);
      const rememberResponse = await handleOrganizationRememberRoute(request, env.DB); if (rememberResponse) return harden(rememberResponse);
      const campaignAdminRememberResponse = await handleCampaignAdminRememberRoute(request, env.DB); if (campaignAdminRememberResponse) return harden(campaignAdminRememberResponse);
      const methodGuard = guardOrganizationApiMethod(request); if (methodGuard) return harden(methodGuard);
      const queryGuard = guardOrganizationSecurityQuery(request); if (queryGuard) return harden(queryGuard);
      const delegationGuard = await guardOrganizationDelegationRequest(request, env.DB); if (delegationGuard) return harden(delegationGuard);
      const legacyGuard = await guardOrganizationManagedLegacyAdminRequest(request, env.DB); if (legacyGuard) return harden(legacyGuard);
      const bootstrapHashResponse = await handleOrganizationBootstrapHashApi(request, env); if (bootstrapHashResponse) return harden(bootstrapHashResponse);
      const invalidations = await captureTrustedDeviceInvalidations(request.clone(), env.DB);
      const securityResponse = await handleOrganizationSecurityApi(request, env); if (securityResponse) return harden(await applyTrustedDeviceInvalidations(env.DB, invalidations, securityResponse));
      const organizationRequest = request.clone();
      const organizationResponse = await handleOrganizationApi(request, env); if (organizationResponse) return harden(await applyTrustedDeviceInvalidations(env.DB, invalidations, await augmentOrganizationRememberResponse(organizationRequest, env.DB, organizationResponse)));
      const roomListResponse = await handleOrganizationFieldGroupList(request, env); if (roomListResponse) return harden(roomListResponse);
      const teamCommentsResponse = await handleTeamCommentsSummary(request, env); if (teamCommentsResponse) return harden(teamCommentsResponse);
      const campaignAdminRequest = request.clone();
      const baseResponse = await baseWorker.fetch(request, env, context);
      const rememberedBaseResponse = await augmentCampaignAdminRememberResponse(campaignAdminRequest, env.DB, baseResponse);
      const invalidatedBaseResponse = await applyTrustedDeviceInvalidations(env.DB, invalidations, rememberedBaseResponse);
      return harden(failClosedOrganizationApiFallback(campaignAdminRequest, await rewriteOrganizationManagedAccessResponse(campaignAdminRequest, env.DB, invalidatedBaseResponse)));
    } catch (error) {
      if (error instanceof OrganizationPasswordKdfUnavailableError) return kdfUnavailableResponse(error, env.ORGANIZATION_KDF_DIAGNOSTICS === "1");
      throw error;
    }
  },
};

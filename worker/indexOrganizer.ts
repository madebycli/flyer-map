import baseWorker from "./indexFc52.ts";
import { handleOrganizationApi, type OrganizationApiEnv } from "./organizationApi.ts";
import { handleOrganizationBootstrapHashApi, type OrganizationBootstrapHashEnv } from "./organizationBootstrapHashApi.ts";
import {
  configureOrganizationPasswordKdfRuntime,
  OrganizationPasswordKdfUnavailableError,
  type OrganizationPasswordKdfNamespace,
} from "./organizationPasswordKdf.ts";
import { handleOrganizationSecurityApi } from "./organizationSecurityApi.ts";
import { guardOrganizationSecurityQuery } from "./organizationSecurityRequest.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";

export { CampaignSyncDurableObject } from "./campaignSyncDurableObject.ts";
export { OrganizationPasswordKdfDurableObject } from "./organizationPasswordKdfDurableObject.ts";

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];
type Env = BaseEnv & OrganizationApiEnv & OrganizationBootstrapHashEnv & {
  ORGANIZATION_PASSWORD_KDF?: OrganizationPasswordKdfNamespace;
  ORGANIZATION_KDF_DIAGNOSTICS?: string;
};

function harden(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("cross-origin-opener-policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function kdfUnavailableResponse(error: OrganizationPasswordKdfUnavailableError, diagnostics: boolean) {
  return harden(Response.json({
    error: {
      code: "organization_password_kdf_unavailable",
      message: "Passwort-Ableitung ist vorübergehend nicht verfügbar.",
      ...(diagnostics ? { details: { reason: error.reason } } : {}),
    },
  }, {
    status: 503,
    headers: { "cache-control": "no-store" },
  }));
}

export default {
  async fetch(request: Request, env: Env, context?: AreaPreparationExecutionContext): Promise<Response> {
    configureOrganizationPasswordKdfRuntime(env.ORGANIZATION_PASSWORD_KDF);
    try {
      const queryGuard = guardOrganizationSecurityQuery(request);
      if (queryGuard) return harden(queryGuard);
      const bootstrapHashResponse = await handleOrganizationBootstrapHashApi(request, env);
      if (bootstrapHashResponse) return harden(bootstrapHashResponse);
      const securityResponse = await handleOrganizationSecurityApi(request, env);
      if (securityResponse) return harden(securityResponse);
      const organizationResponse = await handleOrganizationApi(request, env);
      if (organizationResponse) return harden(organizationResponse);
      return harden(await baseWorker.fetch(request, env, context));
    } catch (error) {
      if (error instanceof OrganizationPasswordKdfUnavailableError) {
        return kdfUnavailableResponse(error, env.ORGANIZATION_KDF_DIAGNOSTICS === "1");
      }
      throw error;
    }
  },
};

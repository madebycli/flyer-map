import baseWorker from "./indexFc52.ts";
import { handleOrganizationApi, type OrganizationApiEnv } from "./organizationApi.ts";
import type { AreaPreparationExecutionContext } from "./areaTaskPreparation.ts";

export { CampaignSyncDurableObject } from "./campaignSyncDurableObject.ts";

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];
type Env = BaseEnv & OrganizationApiEnv;

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

export default {
  async fetch(request: Request, env: Env, context?: AreaPreparationExecutionContext): Promise<Response> {
    const organizationResponse = await handleOrganizationApi(request, env);
    if (organizationResponse) return harden(organizationResponse);
    return harden(await baseWorker.fetch(request, env, context));
  },
};

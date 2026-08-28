import { CampaignApiError } from "./campaignApi.ts";
import type { AutomationRuleState, AutomationRuleType } from "../domain/automations.ts";

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function parseError(response: Response) {
  let payload: ApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    // Keep the generic fallback below.
  }
  return new CampaignApiError(
    response.status,
    payload?.error?.code ?? "request_failed",
    payload?.error?.message ?? `Serveranfrage fehlgeschlagen (${response.status}).`,
  );
}

async function request(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }
  if (!response.ok) throw await parseError(response);
  return response;
}

function automationPath(campaignId: string, ruleType?: string) {
  const suffix = ruleType ? `/${encodeURIComponent(ruleType)}` : "";
  return `/api/campaigns/${encodeURIComponent(campaignId)}/automations${suffix}`;
}

export async function fetchAutomations(campaignId: string, signal?: AbortSignal) {
  const response = await request(automationPath(campaignId), { method: "GET", signal });
  return (await response.json()) as { automations: AutomationRuleState[] };
}

export async function updateAutomation(
  campaignId: string,
  ruleType: AutomationRuleType,
  enabled: boolean,
) {
  const response = await request(automationPath(campaignId, ruleType), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  return (await response.json()) as { automation: AutomationRuleState };
}

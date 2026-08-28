import { CampaignApiError } from "./campaignApi.ts";
import type { ActivityPage } from "../domain/activity.ts";

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

export async function fetchActivity(
  campaignId: string,
  options: {
    teamId?: string | null;
    cursor?: string | null;
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams();
  if (options.teamId) params.set("team", options.teamId);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";

  let response: Response;
  try {
    response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/activity${query}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }

  if (!response.ok) throw await parseError(response);
  return (await response.json()) as ActivityPage;
}

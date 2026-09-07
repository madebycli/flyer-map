import { CampaignApiError } from "./campaignApi.ts";
import type { CampaignStatistics } from "../domain/statistics.ts";

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

async function parseError(response: Response) {
  let payload: ErrorPayload | null = null;
  try {
    payload = (await response.json()) as ErrorPayload;
  } catch {
    // Keep the generic fallback below.
  }
  return new CampaignApiError(
    response.status,
    payload?.error?.code ?? "request_failed",
    payload?.error?.message ?? `Serveranfrage fehlgeschlagen (${response.status}).`,
  );
}

export async function fetchCampaignStatistics(
  campaignId: string,
  options: {
    teamId?: string | null;
    signal?: AbortSignal;
  } = {},
): Promise<CampaignStatistics> {
  const params = new URLSearchParams();
  if (options.teamId) params.set("team", options.teamId);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  let response: Response;
  try {
    response = await fetch(
      `/api/campaigns/${encodeURIComponent(campaignId)}/stats${query}`,
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
  return (await response.json()) as CampaignStatistics;
}

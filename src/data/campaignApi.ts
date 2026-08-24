import type { CampaignSnapshot } from "../domain/campaign";

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
  revision?: number | null;
};

export class CampaignApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly revision: number | null | undefined;

  constructor(status: number, code: string, message: string, revision?: number | null) {
    super(message);
    this.name = "CampaignApiError";
    this.status = status;
    this.code = code;
    this.revision = revision;
  }
}

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
    payload?.revision,
  );
}

async function apiFetch(path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
    });
  } catch {
    throw new CampaignApiError(0, "network_error", "Server ist momentan nicht erreichbar.");
  }

  if (!response.ok) throw await parseError(response);
  return response;
}

function campaignPath(campaignId: string, resource: "snapshot" | "version") {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/${resource}`;
}

export async function fetchCampaignSnapshot(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "snapshot"));
  return (await response.json()) as CampaignSnapshot;
}

export async function putCampaignSnapshot(
  campaignId: string,
  baseRevision: number | null,
  snapshot: CampaignSnapshot,
) {
  const response = await apiFetch(campaignPath(campaignId, "snapshot"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, snapshot }),
  });
  return (await response.json()) as CampaignSnapshot;
}

export async function fetchCampaignVersion(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "version"));
  const payload = (await response.json()) as { campaignId: string; revision: number };
  return payload.revision;
}

export function campaignIdFromUrl() {
  if (typeof window === "undefined") return null;
  const value = new URL(window.location.href).searchParams.get("campaign");
  return value && CAMPAIGN_ID_PATTERN.test(value) ? value : null;
}

export function setCampaignIdInUrl(campaignId: string) {
  if (typeof window === "undefined" || !CAMPAIGN_ID_PATTERN.test(campaignId)) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("campaign") === campaignId) return;
  url.searchParams.set("campaign", campaignId);
  window.history.replaceState(null, "", url);
}

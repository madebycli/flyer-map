import type { CampaignSnapshot } from "../domain/campaign";
import type { CampaignMutation } from "../domain/mutations";

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export type AccessRole = "admin" | "team-editor" | "viewer" | "field-group-member";
export type PersistentAccessRole = Exclude<AccessRole, "field-group-member">;

export type AccessInfo = {
  campaignId: string;
  role: AccessRole;
  teamId: string | null;
  groupId?: string | null;
  label: string | null;
};

export type AccessGrant = Omit<AccessInfo, "role" | "groupId"> & {
  role: PersistentAccessRole;
  grantId: string;
  createdAt: string;
  revokedAt: string | null;
};

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

function campaignPath(
  campaignId: string,
  resource: "snapshot" | "version" | "access" | "mutations",
) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/${resource}`;
}

export async function fetchCampaignSnapshot(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "snapshot"));
  return (await response.json()) as CampaignSnapshot;
}

export async function createCampaignSnapshot(snapshot: CampaignSnapshot) {
  const response = await apiFetch("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot }),
  });
  return (await response.json()) as {
    snapshot: CampaignSnapshot;
    access: AccessInfo;
    initialAccessToken: string;
  };
}

export async function putCampaignSnapshot(
  campaignId: string,
  baseRevision: number,
  snapshot: CampaignSnapshot,
) {
  const response = await apiFetch(campaignPath(campaignId, "snapshot"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, snapshot }),
  });
  return (await response.json()) as CampaignSnapshot;
}

export async function postCampaignMutation(
  campaignId: string,
  mutation: CampaignMutation,
  fieldGroupId: string | null = null,
) {
  const response = await apiFetch(campaignPath(campaignId, "mutations"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutation, fieldGroupId }),
  });
  return (await response.json()) as {
    mutationId: string;
    appliedRevision: number;
    alreadyApplied: boolean;
  };
}

export async function fetchCampaignVersion(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "version"));
  const payload = (await response.json()) as { campaignId: string; revision: number };
  return payload.revision;
}

export async function redeemCampaignAccess(campaignId: string, token: string) {
  const response = await apiFetch("/api/access/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, token }),
  });
  return ((await response.json()) as { access: AccessInfo }).access;
}

export async function recoverCampaignAdminAccess(campaignId: string, secret: string) {
  const response = await apiFetch("/api/admin/recover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, secret }),
  });
  return (await response.json()) as {
    access: AccessInfo;
    initialAccessToken: string;
  };
}

export async function fetchCurrentAccess(campaignId: string) {
  const response = await apiFetch(`/api/access/current?campaign=${encodeURIComponent(campaignId)}`);
  return ((await response.json()) as { access: AccessInfo }).access;
}

export async function fetchAccessGrants(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "access"));
  return ((await response.json()) as { grants: AccessGrant[] }).grants;
}

export async function createCampaignAccessGrant(
  campaignId: string,
  input: { role: PersistentAccessRole; teamId: string | null; label: string },
) {
  const response = await apiFetch(campaignPath(campaignId, "access"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return (await response.json()) as { grant: AccessGrant; token: string };
}

export async function revokeCampaignAccessGrant(campaignId: string, grantId: string) {
  await apiFetch(`${campaignPath(campaignId, "access")}/${encodeURIComponent(grantId)}`, {
    method: "DELETE",
  });
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

export function accessTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const token = params.get("access");
  return token && token.length >= 32 && token.length <= 256 ? token : null;
}

export function removeAccessTokenFromUrl() {
  if (typeof window === "undefined" || !window.location.hash) return;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", url);
}

export function buildCampaignAccessUrl(campaignId: string, token: string) {
  if (typeof window === "undefined") {
    return `?campaign=${encodeURIComponent(campaignId)}#access=${encodeURIComponent(token)}`;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("campaign", campaignId);
  url.hash = new URLSearchParams({ access: token }).toString();
  return url.toString();
}

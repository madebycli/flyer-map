import {
  normalizeAreaPreparationGenerations,
  type CampaignSnapshot,
} from "../domain/campaign.ts";
import type { CampaignMutation } from "../domain/mutations";

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;

export type AccessRole =
  | "admin"
  | "team-editor"
  | "viewer"
  | "field-group-member"
  | "collection-collector";
export type PersistentAccessRole = "admin" | "team-editor" | "viewer";

export type AccessInfo = {
  campaignId: string;
  role: AccessRole;
  teamId: string | null;
  groupId?: string | null;
  label: string | null;
  collectorId?: string | null;
  collectionAccessId?: string | null;
};

export type AccessGrant = Omit<AccessInfo, "role" | "groupId"> & {
  role: PersistentAccessRole;
  grantId: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CampaignAdminAccount = {
  id: string;
  campaignId: string;
  username: string;
  createdAt: string;
  disabledAt: string | null;
};

export type AreaPreparationStatus = "missing" | "pending" | "ready" | "failed";

export type AreaPreparationPublicState = {
  status: AreaPreparationStatus;
  roadCount: number;
  houseCount: number;
  sourceTimestamp: string | null;
  errorCode: string | null;
  updatedAt: string | null;
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

function areaPreparationPath(campaignId: string, areaId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/areas/${encodeURIComponent(areaId)}/preparation`;
}

export async function fetchAreaPreparation(campaignId: string, areaId: string) {
  const response = await apiFetch(areaPreparationPath(campaignId, areaId));
  return (await response.json()) as AreaPreparationPublicState;
}

export async function startAreaPreparation(campaignId: string, areaId: string) {
  const response = await apiFetch(areaPreparationPath(campaignId, areaId), { method: "POST" });
  return (await response.json()) as AreaPreparationPublicState;
}

export async function fetchCampaignSnapshot(campaignId: string) {
  const response = await apiFetch(campaignPath(campaignId, "snapshot"));
  return normalizeAreaPreparationGenerations((await response.json()) as CampaignSnapshot);
}

export async function createCampaignSnapshot(snapshot: CampaignSnapshot) {
  const response = await apiFetch("/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot }),
  });
  const payload = (await response.json()) as {
    snapshot: CampaignSnapshot;
    access: AccessInfo;
    initialAccessToken: string;
  };
  return { ...payload, snapshot: normalizeAreaPreparationGenerations(payload.snapshot) };
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


export async function fetchCollectionSnapshot(campaignId: string) {
  const response = await apiFetch(
    "/api/campaigns/" + encodeURIComponent(campaignId) + "/collection/snapshot",
  );
  return normalizeAreaPreparationGenerations((await response.json()) as CampaignSnapshot);
}

export async function fetchCurrentCollectionAccess(campaignId: string) {
  const response = await apiFetch(
    "/api/collection/access/current?campaign=" + encodeURIComponent(campaignId),
  );
  return ((await response.json()) as { access: AccessInfo }).access;
}

export async function redeemCollectionAccess(campaignId: string, token: string) {
  const response = await apiFetch("/api/collection/access/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, token }),
  });
  return ((await response.json()) as { access: AccessInfo }).access;
}

export async function createCollectionAccessLink(campaignId: string) {
  const response = await apiFetch(
    "/api/campaigns/" + encodeURIComponent(campaignId) + "/collection/access",
    { method: "POST", headers: { "content-type": "application/json" } },
  );
  return (await response.json()) as {
    token: string;
    link: { id: string; campaignId: string; createdAt: string; revokedAt: string | null };
  };
}

export async function fetchCollectionCollectors(campaignId: string) {
  const response = await apiFetch(
    "/api/campaigns/" + encodeURIComponent(campaignId) + "/collection/collectors",
  );
  return (await response.json()) as {
    collectors: Array<{
      id: string;
      campaignId: string;
      accessLinkId: string;
      label: string;
      createdAt: string;
      revokedAt: string | null;
    }>;
  };
}

export async function revokeCollectionCollector(campaignId: string, collectorId: string) {
  await apiFetch(
    "/api/campaigns/" + encodeURIComponent(campaignId) +
      "/collection/collectors/" + encodeURIComponent(collectorId),
    { method: "DELETE" },
  );
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

function campaignAdminAccountsPath(campaignId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/admin-accounts`;
}

export async function fetchCampaignAdminAccounts(campaignId: string) {
  const response = await apiFetch(campaignAdminAccountsPath(campaignId));
  return ((await response.json()) as { accounts: CampaignAdminAccount[] }).accounts;
}

export async function createCampaignAdminSetupInvite(campaignId: string) {
  const response = await apiFetch(`${campaignAdminAccountsPath(campaignId)}/setup-invites`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  return (await response.json()) as { token: string; expiresAt: string };
}

export async function disableCampaignAdminAccount(campaignId: string, accountId: string) {
  await apiFetch(`${campaignAdminAccountsPath(campaignId)}/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
  });
}

export async function loginCampaignAdminAccount(campaignId: string, username: string, password: string) {
  const response = await apiFetch(`${campaignAdminAccountsPath(campaignId)}/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return ((await response.json()) as { access: AccessInfo }).access;
}

export async function completeCampaignAdminAccountSetup(
  campaignId: string,
  token: string,
  username: string,
  password: string,
) {
  const response = await apiFetch("/api/admin-accounts/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, token, username, password }),
  });
  return ((await response.json()) as { access: AccessInfo }).access;
}


export function collectionAccessTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const token = params.get("collection");
  return token && token.length >= 64 && token.length <= 256 ? token : null;
}

export function collectionModeFromUrl() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return url.searchParams.get("collection") === "1" || Boolean(collectionAccessTokenFromUrl());
}

export function removeCollectionAccessTokenFromUrl() {
  if (typeof window === "undefined" || !window.location.hash) return;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  params.delete("collection");
  url.hash = params.toString();
  window.history.replaceState(null, "", url);
}

export function setCollectionModeInUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("collection", "1");
  window.history.replaceState(null, "", url);
}

export function buildCollectionAccessUrl(campaignId: string, token: string) {
  if (typeof window === "undefined") {
    return "?campaign=" + encodeURIComponent(campaignId) + "&collection=1#collection=" + encodeURIComponent(token);
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("campaign", campaignId);
  url.searchParams.set("collection", "1");
  url.hash = new URLSearchParams({ collection: token }).toString();
  return url.toString();
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

export function campaignAdminSetupTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const token = params.get("admin-setup");
  return token && token.length >= 32 && token.length <= 256 ? token : null;
}

export function removeCampaignAdminSetupTokenFromUrl() {
  if (typeof window === "undefined" || !window.location.hash) return;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  params.delete("admin-setup");
  url.hash = params.toString();
  window.history.replaceState(null, "", url);
}

export function buildCampaignAdminSetupUrl(campaignId: string, token: string) {
  if (typeof window === "undefined") {
    return `?campaign=${encodeURIComponent(campaignId)}#admin-setup=${encodeURIComponent(token)}`;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("campaign", campaignId);
  url.hash = new URLSearchParams({ "admin-setup": token }).toString();
  return url.toString();
}

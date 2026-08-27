import { CampaignApiError } from "./campaignApi.ts";

export type FieldGroupMode = "distribution" | "collection";
export type FieldGroupState = "active" | "closed" | "expired";
export type FieldGroupJoinKind = "room-code" | "qr";

export type FieldGroupAccessRole = "admin" | "team-editor" | "viewer" | "field-group-member";

export type FieldGroupAccessInfo = {
  campaignId: string;
  role: FieldGroupAccessRole;
  teamId: string | null;
  groupId: string | null;
  label: string | null;
};

export type FieldGroupSummary = {
  id: string;
  campaignId: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  label: string;
  mode: FieldGroupMode;
  discoverable: boolean;
  state: FieldGroupState;
  participantCount: number | null;
  createdAt: string;
  hardExpiresAt: string;
  closedAt: string | null;
  updatedAt: string;
  joinAvailable: boolean;
  membershipCount: number;
};

export type FieldGroupCredentials = {
  roomCode: string;
  qrToken: string;
};

export type FieldGroupTourSummary = {
  startedAt: string;
  endedAt: string;
  participantCount: number;
  durationSeconds: number;
  personSeconds: number;
};

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

function groupsPath(campaignId: string) {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/field-groups`;
}

function groupPath(campaignId: string, groupId: string) {
  return `${groupsPath(campaignId)}/${encodeURIComponent(groupId)}`;
}

export function createFieldGroupRequestId(scope = "field-group") {
  return `${scope}_${crypto.randomUUID()}`;
}

export async function fetchFieldGroups(campaignId: string, teamId?: string | null) {
  const query = teamId ? `?team=${encodeURIComponent(teamId)}` : "";
  const response = await apiFetch(`${groupsPath(campaignId)}${query}`);
  return ((await response.json()) as { groups: FieldGroupSummary[] }).groups;
}

export async function fetchFieldGroup(campaignId: string, groupId: string) {
  const response = await apiFetch(groupPath(campaignId, groupId));
  return ((await response.json()) as { group: FieldGroupSummary }).group;
}

export async function createFieldGroup(
  campaignId: string,
  input: {
    label: string;
    teamId: string;
    mode?: FieldGroupMode;
    discoverable?: boolean;
    participantCount?: number | null;
  },
  requestId = createFieldGroupRequestId("create"),
) {
  const response = await apiFetch(groupsPath(campaignId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, requestId }),
  });
  return (await response.json()) as {
    group: FieldGroupSummary;
    credentials: FieldGroupCredentials | null;
    alreadyApplied: boolean;
  };
}

export async function updateFieldGroup(
  campaignId: string,
  groupId: string,
  patch: { discoverable?: boolean; participantCount?: number },
) {
  const response = await apiFetch(groupPath(campaignId, groupId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return ((await response.json()) as { group: FieldGroupSummary }).group;
}

export async function rotateFieldGroupCredentials(
  campaignId: string,
  groupId: string,
  requestId = createFieldGroupRequestId("rotate"),
) {
  const response = await apiFetch(`${groupPath(campaignId, groupId)}/credentials/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId }),
  });
  return (await response.json()) as {
    group: FieldGroupSummary;
    credentials: FieldGroupCredentials | null;
    alreadyApplied: boolean;
  };
}

export async function revokeFieldGroupCredentials(campaignId: string, groupId: string) {
  const response = await apiFetch(`${groupPath(campaignId, groupId)}/credentials/revoke`, {
    method: "POST",
  });
  return ((await response.json()) as { group: FieldGroupSummary }).group;
}

export async function joinFieldGroup(
  campaignId: string,
  kind: FieldGroupJoinKind,
  secret: string,
) {
  const response = await apiFetch("/api/field-groups/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ campaignId, kind, secret }),
  });
  return (await response.json()) as {
    group: FieldGroupSummary;
    membership: { id: string; temporary: boolean };
    access: FieldGroupAccessInfo;
    alreadyApplied?: boolean;
  };
}

export async function leaveFieldGroup(campaignId: string, groupId: string) {
  await apiFetch(`${groupPath(campaignId, groupId)}/leave`, { method: "POST" });
}

export async function removeFieldGroupMember(
  campaignId: string,
  groupId: string,
  membershipId: string,
) {
  await apiFetch(
    `${groupPath(campaignId, groupId)}/memberships/${encodeURIComponent(membershipId)}`,
    { method: "DELETE" },
  );
}

export async function closeFieldGroup(
  campaignId: string,
  groupId: string,
  participantCount: number,
) {
  const response = await apiFetch(`${groupPath(campaignId, groupId)}/close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ participantCount }),
  });
  return (await response.json()) as {
    group: FieldGroupSummary;
    tourSummary: FieldGroupTourSummary;
    alreadyApplied?: boolean;
  };
}

export function buildFieldGroupQrJoinUrl(campaignId: string, qrToken: string) {
  if (typeof window === "undefined") {
    return `?campaign=${encodeURIComponent(campaignId)}#groupJoin=${encodeURIComponent(qrToken)}`;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("campaign", campaignId);
  url.hash = new URLSearchParams({ groupJoin: qrToken }).toString();
  return url.toString();
}

export function fieldGroupQrTokenFromUrl() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const token = params.get("groupJoin");
  return token && /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null;
}

export function removeFieldGroupQrTokenFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.hash) return;
  const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  if (!params.has("groupJoin")) return;
  params.delete("groupJoin");
  url.hash = params.toString();
  window.history.replaceState(null, "", url);
}

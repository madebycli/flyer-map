export type OrganizationMembershipDto = {
  id: string;
  organizationId: string;
  organizationName: string;
  accountId: string;
  role: "organizer" | "admin";
  capabilities: string[];
};

export type OrganizationMeDto = {
  account: { id: string; username: string };
  assurance: "mfa" | "recovery";
  memberships: OrganizationMembershipDto[];
};

export type OrganizationCampaignDto = {
  id: string;
  name: string;
  lifecycle: "draft" | "active" | "completed" | "archived";
  map: { lng: number; lat: number; zoom: number; bearing: number } | null;
  createdAt: string;
  updatedAt: string;
};

export class OrganizationApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrganizationApiError";
  }
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const error = record?.error && typeof record.error === "object" ? record.error as Record<string, unknown> : null;
    const code = typeof error?.code === "string" ? error.code : "request_failed";
    const message = typeof error?.message === "string" ? error.message : `Request fehlgeschlagen (${response.status}).`;
    throw new OrganizationApiError(response.status, code, message);
  }
  return payload as T;
}

export function getOrganizationMe() {
  return requestJson<OrganizationMeDto>("/api/organization/me");
}

export function bootstrapOrganizationAccount(input: {
  organizationName: string;
  username: string;
  password: string;
  bootstrapSecret: string;
}) {
  return requestJson<{
    organization: { id: string; name: string };
    account: { id: string; username: string };
    otpauthUri: string;
    recoveryCodes: string[];
    challengeExpiresAt: string;
  }>("/api/organization/bootstrap", { method: "POST", body: JSON.stringify(input) });
}

export function beginOrganizationLogin(username: string, password: string) {
  return requestJson<{ challengeExpiresAt: string; requiresFactor: true }>("/api/organization/login/password", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function completeOrganizationTotp(code: string) {
  return requestJson<{ account: { id: string; username: string }; assurance: "mfa" }>("/api/organization/login/totp", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export function completeOrganizationRecovery(recoveryCode: string) {
  return requestJson<{
    account: { id: string; username: string };
    assurance: "recovery";
    requiresTotpReenrollment: true;
  }>("/api/organization/login/recovery", { method: "POST", body: JSON.stringify({ recoveryCode }) });
}

export function logoutOrganization() {
  return requestJson<{ ok: true }>("/api/organization/logout", { method: "POST", body: "{}" });
}

export function listOrganizationCampaigns(organizationId: string) {
  return requestJson<{ campaigns: OrganizationCampaignDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/campaigns`,
  );
}

export function createOrganizationCampaign(
  organizationId: string,
  input: {
    name: string;
    lifecycle: "draft" | "active";
    map: { lng: number; lat: number; zoom: number; bearing: number };
  },
) {
  return requestJson<{ campaign: OrganizationCampaignDto }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/campaigns`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateOrganizationCampaignLifecycle(
  organizationId: string,
  campaignId: string,
  lifecycle: "draft" | "active" | "completed" | "archived",
) {
  return requestJson<{ ok: true; lifecycle: OrganizationCampaignDto["lifecycle"] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/campaigns/${encodeURIComponent(campaignId)}`,
    { method: "PATCH", body: JSON.stringify({ lifecycle }) },
  );
}

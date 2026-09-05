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

export type OrganizationMemberDto = {
  id: string;
  accountId: string;
  username: string;
  role: "organizer" | "admin";
  capabilities: string[];
  createdAt: string;
  updatedAt: string;
};

export type OrganizationSessionDto = {
  id: string;
  assurance: "mfa" | "recovery";
  createdAt: string;
  expiresAt: string;
  current: boolean;
};

export type OrganizationInviteDto = {
  id: string;
  role: "organizer" | "admin";
  capabilities: string[];
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

export type OrganizationRoleDto = {
  id: string;
  name: string;
  capabilities: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type OrganizationAuditEventDto = {
  id: string;
  actorAccountId: string | null;
  type: string;
  targetType: string | null;
  targetId: string | null;
  details: unknown;
  createdAt: string;
};

export type OrganizationFeatureDto = {
  key: string;
  enabled: boolean;
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

export function listOrganizationMembers(organizationId: string) {
  return requestJson<{ members: OrganizationMemberDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/members`,
  );
}

export function removeOrganizationMember(organizationId: string, membershipId: string) {
  return requestJson<{ ok: true }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    { method: "DELETE" },
  );
}

export function listOrganizationSessions() {
  return requestJson<{ sessions: OrganizationSessionDto[] }>("/api/organization/sessions");
}

export function revokeOrganizationSession(sessionId: string) {
  return requestJson<{ ok: true }>(`/api/organization/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

export function changeOrganizationPassword(organizationId: string, currentPassword: string, nextPassword: string) {
  return requestJson<{ ok: true; requiresLogin: true }>("/api/organization/security/password", {
    method: "POST",
    body: JSON.stringify({ organizationId, currentPassword, nextPassword }),
  });
}

export function changeOrganizationUsername(organizationId: string, currentPassword: string, username: string) {
  return requestJson<{ ok: true; username: string }>("/api/organization/security/username", {
    method: "POST",
    body: JSON.stringify({ organizationId, currentPassword, username }),
  });
}

export function rotateOrganizationRecoveryCodes(organizationId: string, currentPassword: string) {
  return requestJson<{ recoveryCodes: string[] }>("/api/organization/security/recovery-codes", {
    method: "POST",
    body: JSON.stringify({ organizationId, currentPassword }),
  });
}

export function restartOrganizationTotp(organizationId: string, currentPassword: string) {
  return requestJson<{ otpauthUri: string; recoveryCodes: string[]; challengeExpiresAt: string; requiresFactor: true }>(
    "/api/organization/security/totp/restart",
    { method: "POST", body: JSON.stringify({ organizationId, currentPassword }) },
  );
}

export function listOrganizationInvites(organizationId: string) {
  return requestJson<{ invites: OrganizationInviteDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/invites`,
  );
}

export function createOrganizationInvite(
  organizationId: string,
  input: { role: "organizer" | "admin"; capabilities: string[]; expiresInHours?: number },
) {
  return requestJson<{ invite: OrganizationInviteDto; secret: string }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/invites`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function revokeOrganizationInvite(organizationId: string, inviteId: string) {
  return requestJson<{ ok: true }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE" },
  );
}

export function redeemOrganizationInvite(input: { inviteSecret: string; username: string; password: string }) {
  return requestJson<{
    organization: { id: string; name: string };
    account: { id: string; username: string };
    membership: OrganizationMembershipDto;
    otpauthUri: string;
    recoveryCodes: string[];
    challengeExpiresAt: string;
  }>("/api/organization/invites/redeem", { method: "POST", body: JSON.stringify(input) });
}

export function createOrganizationPasswordReset(organizationId: string, accountId: string, expiresInMinutes = 30) {
  return requestJson<{ reset: { id: string; expiresAt: string }; secret: string }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/password-resets`,
    { method: "POST", body: JSON.stringify({ accountId, expiresInMinutes }) },
  );
}

export function redeemOrganizationPasswordReset(resetSecret: string, password: string) {
  return requestJson<{ ok: true }>("/api/organization/password-reset/redeem", {
    method: "POST",
    body: JSON.stringify({ resetSecret, password }),
  });
}

export function listOrganizationRoles(organizationId: string) {
  return requestJson<{ roles: OrganizationRoleDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/roles`,
  );
}

export function createOrganizationRole(organizationId: string, name: string, capabilities: string[]) {
  return requestJson<{ role: OrganizationRoleDto }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/roles`,
    { method: "POST", body: JSON.stringify({ name, capabilities }) },
  );
}

export function updateOrganizationRole(organizationId: string, roleId: string, name: string, capabilities: string[]) {
  return requestJson<{ role: OrganizationRoleDto }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/roles/${encodeURIComponent(roleId)}`,
    { method: "PATCH", body: JSON.stringify({ name, capabilities }) },
  );
}

export function deleteOrganizationRole(organizationId: string, roleId: string) {
  return requestJson<{ ok: true }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/roles/${encodeURIComponent(roleId)}`,
    { method: "DELETE" },
  );
}

export function listOrganizationAudit(organizationId: string) {
  return requestJson<{ events: OrganizationAuditEventDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/audit`,
  );
}

export function listOrganizationFeatures(organizationId: string) {
  return requestJson<{ features: OrganizationFeatureDto[] }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/features`,
  );
}

export function updateOrganizationFeature(organizationId: string, key: string, enabled: boolean) {
  return requestJson<{ feature: OrganizationFeatureDto }>(
    `/api/organizations/${encodeURIComponent(organizationId)}/features`,
    { method: "PUT", body: JSON.stringify({ key, enabled }) },
  );
}

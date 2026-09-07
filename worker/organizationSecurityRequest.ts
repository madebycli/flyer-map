const SECURITY_QUERYLESS_PATHS = new Set([
  "/api/organization/invites/redeem",
  "/api/organization/password-reset/redeem",
  "/api/organization/security/password",
  "/api/organization/security/username",
  "/api/organization/security/recovery-codes",
  "/api/organization/security/totp/restart",
]);

export function guardOrganizationSecurityQuery(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.search || !SECURITY_QUERYLESS_PATHS.has(url.pathname)) return null;
  return Response.json(
    { error: { code: "query_not_allowed", message: "Organization-Security-Endpunkte akzeptieren keine Query-Parameter." } },
    {
      status: 400,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

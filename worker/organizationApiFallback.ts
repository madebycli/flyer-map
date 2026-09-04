function methodNotAllowed(request: Request) {
  return new Response(
    request.method === "HEAD"
      ? null
      : JSON.stringify({
          error: {
            code: "method_not_allowed",
            message: "Diese Methode ist für den API-Endpunkt nicht erlaubt.",
          },
        }),
    {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        allow: "GET",
      },
    },
  );
}

export function guardOrganizationApiMethod(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/organization/me" && request.method !== "GET") {
    return methodNotAllowed(request);
  }
  return null;
}

export function failClosedOrganizationApiFallback(request: Request, response: Response) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return response;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return response;

  const status = request.method === "GET" ? 404 : 405;
  const code = status === 405 ? "method_not_allowed" : "api_route_not_found";
  const message = status === 405
    ? "Diese Methode ist für den API-Endpunkt nicht erlaubt."
    : "Der API-Endpunkt wurde nicht gefunden.";
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.delete("content-length");

  return new Response(
    request.method === "HEAD" ? null : JSON.stringify({ error: { code, message } }),
    { status, headers },
  );
}

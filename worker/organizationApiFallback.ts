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

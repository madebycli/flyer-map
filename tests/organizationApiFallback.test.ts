import assert from "node:assert/strict";
import test from "node:test";
import { failClosedOrganizationApiFallback } from "../worker/organizationApiFallback.ts";

function spaResponse() {
  return new Response("<!doctype html><html><body>spa</body></html>", {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'self'",
      "x-content-type-options": "nosniff",
    },
  });
}

test("HEAD API fallthrough fails closed instead of returning SPA HTML", async () => {
  const response = failClosedOrganizationApiFallback(
    new Request("https://flyer.test/api/organization/me", { method: "HEAD" }),
    spaResponse(),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await response.text(), "");
});

test("unknown GET API fallthrough returns JSON 404", async () => {
  const response = failClosedOrganizationApiFallback(
    new Request("https://flyer.test/api/organization/not-a-route"),
    spaResponse(),
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), {
    error: {
      code: "api_route_not_found",
      message: "Der API-Endpunkt wurde nicht gefunden.",
    },
  });
});

test("normal SPA navigation and real API responses are not rewritten", () => {
  const spa = spaResponse();
  assert.equal(
    failClosedOrganizationApiFallback(new Request("https://flyer.test/organization"), spa),
    spa,
  );

  const api = Response.json({ ok: true }, { status: 200 });
  assert.equal(
    failClosedOrganizationApiFallback(new Request("https://flyer.test/api/organization/me"), api),
    api,
  );
});

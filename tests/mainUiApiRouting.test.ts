import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import publicWorker, { redirectBareRootToOrganizationLogin } from "../worker/indexOrganizer.ts";
import {
  failClosedOrganizationApiFallback,
  guardOrganizationApiMethod,
} from "../worker/organizationApiFallback.ts";
import {
  campaignIdFromOrganizationPath,
  isOrganizationAdminPath,
} from "../src/organization/organizationRoutes.ts";

const MAIN_UI_ROUTES = [
  "/login",
  "/start",
  "/admin",
  "/new",
  "/admin/campaign/campaign_a",
] as const;

test("Main Wrangler keeps UI routes on the SPA asset path and runs only root plus API through the Worker first", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

  assert.equal(config.main, "./worker/indexOrganizer.ts");
  assert.equal(config.assets?.not_found_handling, "single-page-application");
  assert.deepEqual(config.assets?.run_worker_first, ["/api/*", "/"]);

  for (const pathname of MAIN_UI_ROUTES) {
    assert.notEqual(pathname, "/");
    assert.equal(pathname.startsWith("/api/"), false);
    assert.equal(isOrganizationAdminPath(pathname), true);
  }

  assert.equal(campaignIdFromOrganizationPath("/admin/campaign/campaign_a"), "campaign_a");
  assert.equal(isOrganizationAdminPath("/some/deep/spa-route"), false);
});

test("bare root GET and HEAD redirect to login while write methods stay out of static assets", async () => {
  const fetched: string[] = [];
  const env = {
    ASSETS: {
      async fetch(request: Request) {
        fetched.push(request.url);
        return new Response("spa-shell", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      },
    },
  };

  for (const method of ["GET", "HEAD"] as const) {
    const direct = redirectBareRootToOrganizationLogin(
      new Request("https://flyer.test/", { method }),
    );
    assert.equal(direct?.status, 302);
    assert.equal(direct?.headers.get("location"), "https://flyer.test/login");

    const response = await publicWorker.fetch(
      new Request("https://flyer.test/", { method }),
      env,
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "https://flyer.test/login");
    assert.equal(await response.text(), "");
  }

  assert.equal(redirectBareRootToOrganizationLogin(
    new Request("https://flyer.test/", { method: "POST" }),
  ), null);

  const post = await publicWorker.fetch(
    new Request("https://flyer.test/", { method: "POST" }),
    env,
  );
  assert.equal(post.status, 404);
  assert.deepEqual(fetched, []);
});

test("runtime API is GET-only, HEAD is bodyless, and non-GET methods return a stable method gate", async () => {
  const get = await publicWorker.fetch(
    new Request("https://flyer.test/api/runtime"),
    { RUNTIME_ENVIRONMENT: "main", CF_VERSION_METADATA: { id: "routing-test" } } as never,
  );
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type")?.includes("application/json"), true);

  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE"] as const) {
    const response = await publicWorker.fetch(
      new Request("https://flyer.test/api/runtime", { method }),
      {} as never,
    );
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);

    if (method === "HEAD") {
      assert.equal(await response.text(), "");
    } else {
      assert.deepEqual(await response.json(), {
        error: {
          code: "method_not_allowed",
          message: "Der Runtime-Vertrag verwendet GET.",
        },
      });
    }
  }
});

test("organization me method gate rejects HEAD and writes without invoking the API handler", async () => {
  assert.equal(
    guardOrganizationApiMethod(new Request("https://flyer.test/api/organization/me")),
    null,
  );

  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE"] as const) {
    const response = guardOrganizationApiMethod(
      new Request("https://flyer.test/api/organization/me", { method }),
    );
    assert.ok(response);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET");

    if (method === "HEAD") {
      assert.equal(await response.text(), "");
    } else {
      assert.equal((await response.json() as { error: { code: string } }).error.code, "method_not_allowed");
    }
  }
});

test("API fallback never serves SPA HTML and preserves HEAD body semantics", async () => {
  for (const [method, expectedStatus, expectedCode] of [
    ["GET", 404, "api_route_not_found"],
    ["POST", 405, "method_not_allowed"],
    ["HEAD", 405, "method_not_allowed"],
  ] as const) {
    const response = failClosedOrganizationApiFallback(
      new Request("https://flyer.test/api/unknown", { method }),
      new Response("<!doctype html><title>SPA</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");

    if (method === "HEAD") {
      assert.equal(await response.text(), "");
    } else {
      assert.equal((await response.json() as { error: { code: string } }).error.code, expectedCode);
    }
  }

  const spa = new Response("spa-shell", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  const uiResponse = failClosedOrganizationApiFallback(
    new Request("https://flyer.test/login"),
    spa,
  );
  assert.equal(uiResponse, spa);
  assert.equal(await uiResponse.text(), "spa-shell");
});

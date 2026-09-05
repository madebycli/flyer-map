import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import publicWorker from "../worker/indexFc52.ts";
import { redirectBareRootToOrganizationLogin } from "../worker/indexOrganizer.ts";

test("bare Organizer Worker root redirects to central login", () => {
  for (const method of ["GET", "HEAD"] as const) {
    const response = redirectBareRootToOrganizationLogin(new Request("https://flyer.test/", { method }));
    assert.equal(response?.status, 302);
    assert.equal(response?.headers.get("location"), "https://flyer.test/login");
  }
});

test("explicit Campaign field links and workbench links are not redirected", () => {
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/?campaign=campaign_a")),
    null,
  );
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/?workbench=ui")),
    null,
  );
  assert.equal(
    redirectBareRootToOrganizationLogin(new Request("https://flyer.test/admin")),
    null,
  );
});

test("invalid or missing Campaign selectors cannot enter the field runtime", () => {
  for (const url of [
    "https://flyer.test/",
    "https://flyer.test/?foo=bar",
    "https://flyer.test/?campaign=%2Fbad",
  ]) {
    assert.equal(redirectBareRootToOrganizationLogin(new Request(url))?.status, 302);
  }
});

test("Wrangler sends API and exact root requests through the Worker before static assets", async () => {
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(config.assets?.run_worker_first, ["/api/*", "/"]);

  assert.equal(config.main, "./worker/indexFc52.ts");
  assert.equal(
    config.d1_databases?.find((entry: { binding?: string }) => entry.binding === "DB")?.database_id,
    "0113e775-1e43-4d96-8b97-51fdeec7355b",
  );
  assert.deepEqual(
    (config.ratelimits ?? []).map((entry: { namespace_id?: string }) => String(entry.namespace_id)),
    ["91714001", "91714002", "91714003"],
  );
  assert.equal(
    (config.ratelimits ?? []).some((entry: { name?: string }) => entry.name === "ORGANIZATION_LOGIN_LIMITER"),
    false,
  );
  assert.equal((config.compatibility_flags ?? []).includes("nodejs_compat"), false);
});

test("public Worker preserves root SPA assets while APIs remain fail closed", async () => {
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

  const fieldEntry = await publicWorker.fetch(
    new Request("https://flyer.test/?campaign=campaign_a"),
    env,
  );
  assert.equal(fieldEntry.status, 200);
  assert.equal(await fieldEntry.text(), "spa-shell");
  assert.deepEqual(fetched, ["https://flyer.test/?campaign=campaign_a"]);

  const publicRoot = await publicWorker.fetch(new Request("https://flyer.test/"), env);
  assert.equal(publicRoot.status, 200);
  assert.equal(await publicRoot.text(), "spa-shell");
  assert.equal(fetched.length, 2);

  const unknownApi = await publicWorker.fetch(new Request("https://flyer.test/api/unknown"), env);
  assert.equal(unknownApi.status, 404);
  assert.equal(fetched.length, 2);
  const payload = await unknownApi.json() as { error?: { code?: string } };
  assert.equal(payload.error?.code, "not_found");
});

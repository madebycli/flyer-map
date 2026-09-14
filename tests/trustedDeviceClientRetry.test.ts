import assert from "node:assert/strict";
import test from "node:test";
import { getOrganizationMe } from "../src/organization/organizationApiClient.ts";
import { fetchCurrentAccess } from "../src/data/campaignApi.ts";

function withFetch(t: test.TestContext, implementation: typeof fetch) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: implementation });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor);
    else Reflect.deleteProperty(globalThis, "fetch");
  });
}

test("organization client refreshes a remembered device once after authentication_required and retries the original request", async (t) => {
  const calls: Array<{ path: string; method: string }> = [];
  let meAttempts = 0;
  withFetch(t, async (input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : new URL(input.url).pathname;
    const method = init?.method ?? "GET";
    calls.push({ path, method });
    if (path === "/api/organization/me") {
      meAttempts += 1;
      if (meAttempts === 1) {
        return Response.json({ error: { code: "authentication_required", message: "expired" } }, { status: 401 });
      }
      return Response.json({ account: { id: "org_account_a", username: "Alice" }, assurance: "mfa", memberships: [] });
    }
    if (path === "/api/organization/session/refresh") return Response.json({ ok: true });
    return new Response(null, { status: 404 });
  });

  const me = await getOrganizationMe();
  assert.equal(me.account.id, "org_account_a");
  assert.deepEqual(calls, [
    { path: "/api/organization/me", method: "GET" },
    { path: "/api/organization/session/refresh", method: "POST" },
    { path: "/api/organization/me", method: "GET" },
  ]);
});

test("parallel organization 401s share exactly one rotating remember refresh", async (t) => {
  let meAttempts = 0;
  let refreshes = 0;
  withFetch(t, async (input) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    if (url.pathname === "/api/organization/me") {
      meAttempts += 1;
      if (meAttempts <= 2) return Response.json({ error: { code: "authentication_required" } }, { status: 401 });
      return Response.json({ account: { id: "org_account_a", username: "Alice" }, assurance: "mfa", memberships: [] });
    }
    if (url.pathname === "/api/organization/session/refresh") {
      refreshes += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  });

  const [left, right] = await Promise.all([getOrganizationMe(), getOrganizationMe()]);
  assert.equal(left.account.id, "org_account_a");
  assert.equal(right.account.id, "org_account_a");
  assert.equal(refreshes, 1, "one-time remember credentials must not be consumed twice by parallel requests");
  assert.equal(meAttempts, 4);
});

test("campaign client refreshes a remembered admin once after access_required and retries the original request", async (t) => {
  const calls: Array<{ path: string; method: string }> = [];
  let accessAttempts = 0;
  withFetch(t, async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    const path = `${url.pathname}${url.search}`;
    const method = init?.method ?? "GET";
    calls.push({ path, method });
    if (url.pathname === "/api/access/current") {
      accessAttempts += 1;
      if (accessAttempts === 1) {
        return Response.json({ error: { code: "access_required", message: "expired" } }, { status: 401 });
      }
      return Response.json({ access: { campaignId: "campaign_n", role: "admin", teamId: null, label: "Admin" } });
    }
    if (url.pathname === "/api/campaigns/campaign_n/admin-accounts/session/refresh") return Response.json({ ok: true });
    return new Response(null, { status: 404 });
  });

  const access = await fetchCurrentAccess("campaign_n");
  assert.equal(access.role, "admin");
  assert.deepEqual(calls, [
    { path: "/api/access/current?campaign=campaign_n", method: "GET" },
    { path: "/api/campaigns/campaign_n/admin-accounts/session/refresh", method: "POST" },
    { path: "/api/access/current?campaign=campaign_n", method: "GET" },
  ]);
});

test("parallel campaign 401s share one campaign-scoped remember refresh", async (t) => {
  let accessAttempts = 0;
  let refreshes = 0;
  withFetch(t, async (input) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    if (url.pathname === "/api/access/current") {
      accessAttempts += 1;
      if (accessAttempts <= 2) return Response.json({ error: { code: "access_required" } }, { status: 401 });
      return Response.json({ access: { campaignId: "campaign_n", role: "admin", teamId: null, label: "Admin" } });
    }
    if (url.pathname === "/api/campaigns/campaign_n/admin-accounts/session/refresh") {
      refreshes += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return Response.json({ ok: true });
    }
    return new Response(null, { status: 404 });
  });

  const [left, right] = await Promise.all([fetchCurrentAccess("campaign_n"), fetchCurrentAccess("campaign_n")]);
  assert.equal(left.role, "admin");
  assert.equal(right.role, "admin");
  assert.equal(refreshes, 1);
  assert.equal(accessAttempts, 4);
});

test("remember refresh failure does not loop or hide the original authentication failure", async (t) => {
  const calls: string[] = [];
  withFetch(t, async (input) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    calls.push(url.pathname);
    if (url.pathname === "/api/organization/session/refresh") {
      return Response.json({ error: { code: "remembered_device_invalid" } }, { status: 401 });
    }
    return Response.json({ error: { code: "authentication_required", message: "expired" } }, { status: 401 });
  });

  await assert.rejects(getOrganizationMe(), (error: unknown) => {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code: string }).code === "authentication_required");
  });
  assert.deepEqual(calls, ["/api/organization/me", "/api/organization/session/refresh"]);
});

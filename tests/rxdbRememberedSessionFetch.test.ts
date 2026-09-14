import assert from "node:assert/strict";
import test from "node:test";
import { rememberedSessionFetch } from "../src/data/rxdbMissionSync.ts";

function accessRequired() {
  return Response.json({ error: { code: "access_required" } }, { status: 401 });
}

test("RxDB transport renews an expired organization session before retrying the request", async () => {
  let originalAttempts = 0;
  let organizationRefreshes = 0;
  let campaignRefreshes = 0;
  const rawFetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    if (url.pathname === "/api/organization/session/refresh") {
      organizationRefreshes += 1;
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/campaigns/campaign_n/admin-accounts/session/refresh") {
      campaignRefreshes += 1;
      return Response.json({ ok: true });
    }
    originalAttempts += 1;
    return originalAttempts === 1 ? accessRequired() : Response.json({ ok: true });
  }) as typeof fetch;

  const authenticated = rememberedSessionFetch("campaign_n", rawFetch);
  const response = await authenticated("/api/campaigns/campaign_n/rxdb/checkpoint");
  assert.equal(response.status, 200);
  assert.equal(organizationRefreshes, 1);
  assert.equal(campaignRefreshes, 0, "organization renewal must not consume a campaign-admin remember credential");
  assert.equal(originalAttempts, 2);
});

test("RxDB transport falls back to campaign-admin remember renewal when no organization device exists", async () => {
  let originalAttempts = 0;
  let organizationRefreshes = 0;
  let campaignRefreshes = 0;
  const rawFetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    if (url.pathname === "/api/organization/session/refresh") {
      organizationRefreshes += 1;
      return Response.json({ error: { code: "remembered_device_invalid" } }, { status: 401 });
    }
    if (url.pathname === "/api/campaigns/campaign_n/admin-accounts/session/refresh") {
      campaignRefreshes += 1;
      return Response.json({ ok: true });
    }
    originalAttempts += 1;
    return originalAttempts === 1 ? accessRequired() : Response.json({ ok: true });
  }) as typeof fetch;

  const authenticated = rememberedSessionFetch("campaign_n", rawFetch);
  const response = await authenticated("/api/campaigns/campaign_n/rxdb/pull/teams", { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal(organizationRefreshes, 1);
  assert.equal(campaignRefreshes, 1);
  assert.equal(originalAttempts, 2);
});

test("parallel RxDB 401s share one remember renewal chain", async () => {
  let originalAttempts = 0;
  let organizationRefreshes = 0;
  const rawFetch = (async (input: RequestInfo | URL) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const url = new URL(raw, "https://flyer.test");
    if (url.pathname === "/api/organization/session/refresh") {
      organizationRefreshes += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      return Response.json({ ok: true });
    }
    originalAttempts += 1;
    return originalAttempts <= 2 ? accessRequired() : Response.json({ ok: true });
  }) as typeof fetch;

  const authenticated = rememberedSessionFetch("campaign_n", rawFetch);
  const [left, right] = await Promise.all([
    authenticated("/api/campaigns/campaign_n/rxdb/pull/teams", { method: "POST" }),
    authenticated("/api/campaigns/campaign_n/rxdb/pull/areas", { method: "POST" }),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.equal(organizationRefreshes, 1);
  assert.equal(originalAttempts, 4);
});

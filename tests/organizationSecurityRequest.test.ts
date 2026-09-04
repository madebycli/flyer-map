import assert from "node:assert/strict";
import test from "node:test";
import { guardOrganizationSecurityQuery } from "../worker/organizationSecurityRequest.ts";

test("organization security endpoints reject query parameters fail-closed", async () => {
  const guarded = guardOrganizationSecurityQuery(new Request("https://example.test/api/organization/invites/redeem?mode=invite", { method: "POST" }));
  assert.ok(guarded);
  assert.equal(guarded.status, 400);
  const payload = await guarded.json() as { error: { code: string } };
  assert.equal(payload.error.code, "query_not_allowed");
});

test("organization security guard leaves queryless requests untouched", () => {
  assert.equal(guardOrganizationSecurityQuery(new Request("https://example.test/api/organization/invites/redeem", { method: "POST" })), null);
  assert.equal(guardOrganizationSecurityQuery(new Request("https://example.test/api/organization/me?view=full")), null);
});

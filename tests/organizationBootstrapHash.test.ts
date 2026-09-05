import assert from "node:assert/strict";
import test from "node:test";
import { hashSecret } from "../worker/access.ts";
import { organizationBootstrapHashMatches } from "../worker/organizationBootstrapHashApi.ts";

test("bootstrap SHA-256 credential accepts only the original high-entropy secret", async () => {
  const secret = "staging-bootstrap-secret-with-sufficient-entropy-1234567890";
  const digest = await hashSecret(secret);
  assert.equal(await organizationBootstrapHashMatches(secret, digest), true);
  assert.equal(await organizationBootstrapHashMatches(`${secret}-wrong`, digest), false);
});

test("bootstrap SHA-256 credential rejects malformed or missing hashes", async () => {
  assert.equal(await organizationBootstrapHashMatches("secret", "not-a-sha256"), false);
  assert.equal(await organizationBootstrapHashMatches("", "0".repeat(64)), false);
});

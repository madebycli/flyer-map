import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveOrganizationPasswordPbkdf2Local,
  deriveOrganizationPasswordPbkdf2Portable,
} from "../worker/organizationPasswordKdf.ts";

test("portable organization PBKDF2 matches native PBKDF2 at the accepted 600k work factor", async () => {
  const password = "correct horse battery staple mit umlaut ä";
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
  const iterations = 600_000;

  const expected = await deriveOrganizationPasswordPbkdf2Local(password, salt, iterations);
  const actual = await deriveOrganizationPasswordPbkdf2Portable(password, salt, iterations);

  assert.equal(actual.byteLength, 32);
  assert.deepEqual(actual, expected);
});

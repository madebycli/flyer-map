import assert from "node:assert/strict";
import test from "node:test";
import { deriveOrganizationPasswordPbkdf2 } from "../worker/organizationPasswordKdf.ts";

const salt = Uint8Array.from({ length: 16 }, (_, index) => index);

test("organization password KDF keeps PBKDF2-SHA256 at 600k without WebCrypto", async () => {
  const derived = await deriveOrganizationPasswordPbkdf2("runtime-cap-regression", salt, 600_000);
  assert.equal(derived.byteLength, 32);
  assert.equal(
    Buffer.from(derived).toString("hex"),
    "638cc00358a9d560acc69d469fd79834b780b264f165acf82f965b7ca7edb69c",
  );
});

test("organization password KDF rejects invalid work factors", async () => {
  await assert.rejects(() => deriveOrganizationPasswordPbkdf2("password", salt, 0));
  await assert.rejects(() => deriveOrganizationPasswordPbkdf2("password", salt, 5_000_001));
});

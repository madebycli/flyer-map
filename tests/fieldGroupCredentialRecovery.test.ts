
import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptFieldGroupCredential,
  encryptFieldGroupCredential,
  FieldGroupCredentialRecoveryError,
} from "../worker/fieldGroupCredentialRecovery.ts";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const CONTEXT = {
  campaignId: "campaign_a",
  groupId: "field_group_a",
  credentialId: "credential_a",
  kind: "room-code" as const,
};

test("recoverable Room credential round-trips only with matching AES-GCM AAD", async () => {
  const encrypted = await encryptFieldGroupCredential(KEY, CONTEXT, "23456789AB");
  assert.notEqual(encrypted.ciphertextB64, "23456789AB");
  assert.equal(await decryptFieldGroupCredential(KEY, CONTEXT, encrypted), "23456789AB");

  await assert.rejects(
    () => decryptFieldGroupCredential(KEY, { ...CONTEXT, groupId: "field_group_b" }, encrypted),
    (error: unknown) => error instanceof FieldGroupCredentialRecoveryError && error.code === "credential_recovery_failed",
  );
});

test("credential recovery fails closed for missing or malformed key material", async () => {
  await assert.rejects(
    () => encryptFieldGroupCredential(undefined, CONTEXT, "23456789AB"),
    (error: unknown) => error instanceof FieldGroupCredentialRecoveryError && error.code === "credential_recovery_unconfigured",
  );
  await assert.rejects(
    () => encryptFieldGroupCredential("short", CONTEXT, "23456789AB"),
    (error: unknown) => error instanceof FieldGroupCredentialRecoveryError && error.code === "credential_recovery_unconfigured",
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  configureOrganizationPasswordKdfRuntime,
  deriveOrganizationPasswordPbkdf2,
  deriveOrganizationPasswordPbkdf2Local,
  deriveOrganizationPasswordPbkdf2Portable,
  ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS,
  OrganizationPasswordKdfUnavailableError,
  resetOrganizationPasswordKdfRuntimeForTests,
  type OrganizationPasswordKdfNamespace,
} from "../worker/organizationPasswordKdf.ts";
import { OrganizationPasswordKdfDurableObject } from "../worker/organizationPasswordKdfDurableObject.ts";

test("organization password KDF routes Worker hashing through bounded Durable Object chunks", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const password = "correct horse battery staple";
  const iterations = 320_000;
  const expected = await deriveOrganizationPasswordPbkdf2Local(password, salt, iterations);
  const durableObject = new OrganizationPasswordKdfDurableObject({}, {});
  let calls = 0;
  let partition = "";

  const namespace: OrganizationPasswordKdfNamespace = {
    idFromName(name) {
      partition = name;
      return name;
    },
    get() {
      return {
        async fetch(input, init) {
          calls += 1;
          return durableObject.fetch(new Request(input, init));
        },
      };
    },
  };

  configureOrganizationPasswordKdfRuntime(namespace);
  try {
    const actual = await deriveOrganizationPasswordPbkdf2(password, salt, iterations);
    assert.deepEqual(actual, expected);
    assert.equal(calls, 2);
    assert.equal(ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS, 300_000);
    assert.equal(Math.ceil(600_000 / ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS), 2);
    assert.match(partition, /^[a-f0-9]{32}$/u);
  } finally {
    resetOrganizationPasswordKdfRuntimeForTests();
  }
});

test("organization password KDF preserves the accepted 600k PBKDF2 verifier across chunks", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => 31 - index);
  const password = "six-hundred-thousand-iterations";
  const expected = await deriveOrganizationPasswordPbkdf2Local(password, salt, 600_000);
  const actual = await deriveOrganizationPasswordPbkdf2Portable(password, salt, 600_000);
  assert.deepEqual(actual, expected);
});

test("organization password KDF fails closed in a Worker runtime without its Durable Object binding", async () => {
  configureOrganizationPasswordKdfRuntime(undefined);
  try {
    await assert.rejects(
      deriveOrganizationPasswordPbkdf2("valid-password-123", new Uint8Array(16).fill(7), 2_000),
      (error: unknown) => error instanceof OrganizationPasswordKdfUnavailableError && error.reason === "binding_missing",
    );
  } finally {
    resetOrganizationPasswordKdfRuntimeForTests();
  }
});

test("organization password KDF preserves a safe Durable Object failure reason", async () => {
  const namespace: OrganizationPasswordKdfNamespace = {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          return Response.json({ error: { code: "kdf_failed" } }, { status: 500 });
        },
      };
    },
  };
  configureOrganizationPasswordKdfRuntime(namespace);
  try {
    await assert.rejects(
      deriveOrganizationPasswordPbkdf2("valid-password-123", new Uint8Array(16).fill(8), 2_000),
      (error: unknown) => error instanceof OrganizationPasswordKdfUnavailableError && error.reason === "response_500_kdf_failed",
    );
  } finally {
    resetOrganizationPasswordKdfRuntimeForTests();
  }
});

test("organization password KDF Durable Object validates continuation state", async () => {
  const durableObject = new OrganizationPasswordKdfDurableObject({}, {});
  const salt = Array.from({ length: 16 }, (_, index) => index + 10);
  const response = await durableObject.fetch(new Request("https://organization-password-kdf.internal/derive", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-organization-password-kdf-internal": "1",
    },
    body: JSON.stringify({
      password: "do-runtime-password-123",
      salt,
      iterations: 320_000,
      completedIterations: 300_000,
    }),
  }));
  assert.equal(response.status, 400);
  const payload = await response.json() as { error: { code: string } };
  assert.equal(payload.error.code, "invalid_request");
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  configureOrganizationPasswordKdfRuntime,
  deriveOrganizationPasswordPbkdf2,
  deriveOrganizationPasswordPbkdf2Local,
  OrganizationPasswordKdfUnavailableError,
  resetOrganizationPasswordKdfRuntimeForTests,
  type OrganizationPasswordKdfNamespace,
} from "../worker/organizationPasswordKdf.ts";
import { OrganizationPasswordKdfDurableObject } from "../worker/organizationPasswordKdfDurableObject.ts";

test("organization password KDF routes Worker hashing through the configured Durable Object binding", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const password = "correct horse battery staple";
  const iterations = 2_000;
  const expected = await deriveOrganizationPasswordPbkdf2Local(password, salt, iterations);
  let calls = 0;
  let partition = "";

  const namespace: OrganizationPasswordKdfNamespace = {
    idFromName(name) {
      partition = name;
      return name;
    },
    get() {
      return {
        async fetch(_input, init) {
          calls += 1;
          assert.equal(init?.method, "POST");
          const body = typeof init?.body === "string" ? init.body : "{}";
          const payload = JSON.parse(body) as { password: string; salt: number[]; iterations: number };
          const derived = await deriveOrganizationPasswordPbkdf2Local(
            payload.password,
            Uint8Array.from(payload.salt),
            payload.iterations,
          );
          return Response.json({ derivedKey: Array.from(derived) });
        },
      };
    },
  };

  configureOrganizationPasswordKdfRuntime(namespace);
  try {
    const actual = await deriveOrganizationPasswordPbkdf2(password, salt, iterations);
    assert.deepEqual(actual, expected);
    assert.equal(calls, 1);
    assert.match(partition, /^[a-f0-9]{32}$/u);
  } finally {
    resetOrganizationPasswordKdfRuntimeForTests();
  }
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

test("organization password KDF Durable Object derives the same key as the local backend", async () => {
  const durableObject = new OrganizationPasswordKdfDurableObject({}, {});
  const salt = Array.from({ length: 16 }, (_, index) => index + 10);
  const response = await durableObject.fetch(new Request("https://organization-password-kdf.internal/derive", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-organization-password-kdf-internal": "1",
    },
    body: JSON.stringify({ password: "do-runtime-password-123", salt, iterations: 2_000 }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json() as { derivedKey: number[] };
  const expected = await deriveOrganizationPasswordPbkdf2Local(
    "do-runtime-password-123",
    Uint8Array.from(salt),
    2_000,
  );
  assert.deepEqual(Uint8Array.from(payload.derivedKey), expected);
});

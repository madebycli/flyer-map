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

test("organization password KDF uses one outer DO request and bounded child DO chunks", async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const password = "correct horse battery staple";
  const iterations = 52_000;
  const expected = await deriveOrganizationPasswordPbkdf2Local(password, salt, iterations);
  let outerCalls = 0;
  let childCalls = 0;
  let orchestrator: OrganizationPasswordKdfDurableObject;
  let child: OrganizationPasswordKdfDurableObject;

  const namespace: OrganizationPasswordKdfNamespace = {
    idFromName(name) {
      return name;
    },
    get(id) {
      return {
        async fetch(input, init) {
          const request = new Request(input, init);
          if (String(id).startsWith("chunk:")) {
            childCalls += 1;
            return child.fetch(request);
          }
          outerCalls += 1;
          return orchestrator.fetch(request);
        },
      };
    },
  };
  orchestrator = new OrganizationPasswordKdfDurableObject({}, { ORGANIZATION_PASSWORD_KDF: namespace });
  child = new OrganizationPasswordKdfDurableObject({}, { ORGANIZATION_PASSWORD_KDF: namespace });

  configureOrganizationPasswordKdfRuntime(namespace);
  try {
    const actual = await deriveOrganizationPasswordPbkdf2(password, salt, iterations);
    assert.deepEqual(actual, expected);
    assert.equal(outerCalls, 1);
    assert.equal(childCalls, 3);
    assert.equal(ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS, 25_000);
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

test("organization password KDF orchestrator fails closed without its child binding", async () => {
  const durableObject = new OrganizationPasswordKdfDurableObject({}, {});
  const response = await durableObject.fetch(new Request("https://organization-password-kdf.internal/derive", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-organization-password-kdf-internal": "1",
    },
    body: JSON.stringify({
      password: "do-runtime-password-123",
      salt: Array.from({ length: 16 }, (_, index) => index + 10),
      iterations: 30_000,
    }),
  }));
  assert.equal(response.status, 503);
  const payload = await response.json() as { error: { code: string } };
  assert.equal(payload.error.code, "kdf_binding_missing");
});

test("organization password KDF child Durable Object validates continuation state", async () => {
  const durableObject = new OrganizationPasswordKdfDurableObject({}, {});
  const salt = Array.from({ length: 16 }, (_, index) => index + 10);
  const response = await durableObject.fetch(new Request("https://organization-password-kdf.internal/chunk", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-organization-password-kdf-internal": "1",
    },
    body: JSON.stringify({
      password: "do-runtime-password-123",
      salt,
      iterations: 30_000,
      completedIterations: 25_000,
    }),
  }));
  assert.equal(response.status, 400);
  const payload = await response.json() as { error: { code: string } };
  assert.equal(payload.error.code, "invalid_request");
});

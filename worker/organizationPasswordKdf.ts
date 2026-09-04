import { pbkdf2 } from "node:crypto";

const PASSWORD_KEY_BYTES = 32;
const MAX_PASSWORD_PBKDF2_ITERATIONS = 5_000_000;
const INTERNAL_KDF_URL = "https://organization-password-kdf.internal/derive";
const INTERNAL_KDF_HEADER = "x-organization-password-kdf-internal";

export type OrganizationPasswordKdfNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

export class OrganizationPasswordKdfUnavailableError extends Error {
  constructor() {
    super("organization_password_kdf_unavailable");
    this.name = "OrganizationPasswordKdfUnavailableError";
  }
}

let runtimeNamespace: OrganizationPasswordKdfNamespace | null | undefined;

function validateIterations(iterations: number) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_PBKDF2_ITERATIONS) {
    throw new Error("organization_password_iterations_invalid");
  }
}

export function configureOrganizationPasswordKdfRuntime(namespace: OrganizationPasswordKdfNamespace | undefined) {
  // `undefined` is converted to null so a deployed Organizer Worker never
  // silently falls back to an expensive in-request PBKDF2 operation.
  runtimeNamespace = namespace ?? null;
}

export function resetOrganizationPasswordKdfRuntimeForTests() {
  runtimeNamespace = undefined;
}

export async function deriveOrganizationPasswordPbkdf2Local(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  validateIterations(iterations);
  const workerSalt = new Uint8Array(salt.byteLength);
  workerSalt.set(salt);
  return new Promise<Uint8Array>((resolve, reject) => {
    pbkdf2(password, workerSalt, iterations, PASSWORD_KEY_BYTES, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      const output = new Uint8Array(derivedKey.byteLength);
      output.set(derivedKey);
      resolve(output);
    });
  });
}

async function deriveThroughDurableObject(
  namespace: OrganizationPasswordKdfNamespace,
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  validateIterations(iterations);
  const partition = Array.from(salt, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32) || "default";
  const stub = namespace.get(namespace.idFromName(partition));
  let response: Response;
  try {
    response = await stub.fetch(INTERNAL_KDF_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_KDF_HEADER]: "1",
      },
      body: JSON.stringify({ password, salt: Array.from(salt), iterations }),
    });
  } catch {
    throw new OrganizationPasswordKdfUnavailableError();
  }
  if (!response.ok) throw new OrganizationPasswordKdfUnavailableError();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OrganizationPasswordKdfUnavailableError();
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OrganizationPasswordKdfUnavailableError();
  }
  const derivedKey = (payload as Record<string, unknown>).derivedKey;
  if (
    !Array.isArray(derivedKey) ||
    derivedKey.length !== PASSWORD_KEY_BYTES ||
    derivedKey.some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new OrganizationPasswordKdfUnavailableError();
  }
  return Uint8Array.from(derivedKey as number[]);
}

export async function deriveOrganizationPasswordPbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  if (runtimeNamespace === undefined) {
    // Node unit tests do not have Worker bindings; keeping a local backend here
    // also verifies compatibility with the Durable Object implementation.
    return deriveOrganizationPasswordPbkdf2Local(password, salt, iterations);
  }
  if (runtimeNamespace === null) throw new OrganizationPasswordKdfUnavailableError();
  return deriveThroughDurableObject(runtimeNamespace, password, salt, iterations);
}

export const ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER = INTERNAL_KDF_HEADER;

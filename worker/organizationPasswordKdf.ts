import { createHmac, pbkdf2Sync } from "node:crypto";

const PASSWORD_KEY_BYTES = 32;
const MAX_PASSWORD_PBKDF2_ITERATIONS = 5_000_000;
const INTERNAL_KDF_URL = "https://organization-password-kdf.internal/derive";
const INTERNAL_KDF_HEADER = "x-organization-password-kdf-internal";
const SAFE_KDF_CODE = /^[a-z0-9_]{1,80}$/u;

export type OrganizationPasswordKdfNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

export class OrganizationPasswordKdfUnavailableError extends Error {
  constructor(readonly reason = "unavailable") {
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
  const derivedKey = pbkdf2Sync(password, workerSalt, iterations, PASSWORD_KEY_BYTES, "sha256");
  const output = new Uint8Array(derivedKey.byteLength);
  output.set(derivedKey);
  return output;
}

/**
 * Standards-equivalent PBKDF2-HMAC-SHA-256 for runtimes whose native PBKDF2
 * primitive enforces a lower iteration ceiling than our accepted 600k policy.
 *
 * The Organization verifier is exactly one SHA-256 block (32 bytes), so PBKDF2
 * only needs block index 1. HMAC itself remains native; only the iteration loop
 * is expressed here. This keeps the stored verifier byte-for-byte compatible
 * with node:crypto PBKDF2 without reducing the configured work factor.
 */
export async function deriveOrganizationPasswordPbkdf2Portable(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  validateIterations(iterations);
  const workerSalt = new Uint8Array(salt.byteLength);
  workerSalt.set(salt);
  const key = new TextEncoder().encode(password);
  const blockIndex = new Uint8Array([0, 0, 0, 1]);

  let previous = createHmac("sha256", key)
    .update(workerSalt)
    .update(blockIndex)
    .digest();
  const output = Uint8Array.from(previous);

  for (let iteration = 2; iteration <= iterations; iteration += 1) {
    previous = createHmac("sha256", key).update(previous).digest();
    for (let index = 0; index < PASSWORD_KEY_BYTES; index += 1) {
      output[index] ^= previous[index];
    }
  }
  return output;
}

async function responseFailureReason(response: Response) {
  let code = "unknown";
  try {
    const payload = await response.clone().json() as unknown;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const error = (payload as Record<string, unknown>).error;
      if (error && typeof error === "object" && !Array.isArray(error)) {
        const candidate = (error as Record<string, unknown>).code;
        if (typeof candidate === "string" && SAFE_KDF_CODE.test(candidate)) code = candidate;
      }
    }
  } catch {
    // The status itself is enough for a safe staging diagnostic.
  }
  return `response_${response.status}_${code}`;
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
    throw new OrganizationPasswordKdfUnavailableError("fetch_exception");
  }
  if (!response.ok) throw new OrganizationPasswordKdfUnavailableError(await responseFailureReason(response));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OrganizationPasswordKdfUnavailableError("invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OrganizationPasswordKdfUnavailableError("invalid_response");
  }
  const derivedKey = (payload as Record<string, unknown>).derivedKey;
  if (
    !Array.isArray(derivedKey) ||
    derivedKey.length !== PASSWORD_KEY_BYTES ||
    derivedKey.some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw new OrganizationPasswordKdfUnavailableError("invalid_derived_key");
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
  if (runtimeNamespace === null) throw new OrganizationPasswordKdfUnavailableError("binding_missing");
  return deriveThroughDurableObject(runtimeNamespace, password, salt, iterations);
}

export const ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER = INTERNAL_KDF_HEADER;

import { createHmac, pbkdf2Sync } from "node:crypto";

const PASSWORD_KEY_BYTES = 32;
const MAX_PASSWORD_PBKDF2_ITERATIONS = 5_000_000;
const PASSWORD_PBKDF2_CHUNK_ITERATIONS = 25_000;
const DURABLE_OBJECT_FETCH_ATTEMPTS = 3;
const INTERNAL_KDF_URL = "https://organization-password-kdf.internal/derive";
const INTERNAL_KDF_HEADER = "x-organization-password-kdf-internal";
const SAFE_KDF_CODE = /^[a-z0-9_]{1,80}$/u;

export type OrganizationPasswordKdfNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

export type OrganizationPasswordPbkdf2ChunkState = {
  completedIterations: number;
  previous: Uint8Array;
  accumulator: Uint8Array;
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

function validChunkBytes(value: Uint8Array) {
  return value.byteLength === PASSWORD_KEY_BYTES;
}

function validateChunkState(state: OrganizationPasswordPbkdf2ChunkState, iterations: number) {
  if (
    !Number.isInteger(state.completedIterations) ||
    state.completedIterations < 1 ||
    state.completedIterations > iterations ||
    !validChunkBytes(state.previous) ||
    !validChunkBytes(state.accumulator)
  ) {
    throw new Error("organization_password_kdf_state_invalid");
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

/**
 * Durable Objects can transiently reset during a Worker code rollout. Retrying a
 * thrown fetch is safe for this KDF because neither the orchestrator nor a chunk
 * mutates persistent state, and callers only accept state from successful replies.
 */
export async function fetchOrganizationPasswordKdfDurableObjectWithRetry(
  stub: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> },
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < DURABLE_OBJECT_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return await stub.fetch(input, init);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
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
 * Computes at most one bounded slice of the standard PBKDF2-HMAC-SHA-256
 * iteration chain. The state is exactly the PBKDF2 U value and XOR accumulator,
 * so chaining slices is byte-for-byte equivalent to a single 600k PBKDF2 call.
 */
export async function deriveOrganizationPasswordPbkdf2PortableChunk(
  password: string,
  salt: Uint8Array,
  iterations: number,
  state?: OrganizationPasswordPbkdf2ChunkState,
) {
  validateIterations(iterations);
  const workerSalt = new Uint8Array(salt.byteLength);
  workerSalt.set(salt);
  const key = new TextEncoder().encode(password);

  let completedIterations = 0;
  let previous: Uint8Array;
  let accumulator: Uint8Array;
  let performedIterations = 0;

  if (state) {
    validateChunkState(state, iterations);
    completedIterations = state.completedIterations;
    previous = Uint8Array.from(state.previous);
    accumulator = Uint8Array.from(state.accumulator);
  } else {
    const blockIndex = new Uint8Array([0, 0, 0, 1]);
    const first = createHmac("sha256", key)
      .update(workerSalt)
      .update(blockIndex)
      .digest();
    previous = Uint8Array.from(first);
    accumulator = Uint8Array.from(first);
    completedIterations = 1;
    performedIterations = 1;
  }

  while (
    completedIterations < iterations &&
    performedIterations < PASSWORD_PBKDF2_CHUNK_ITERATIONS
  ) {
    previous = Uint8Array.from(createHmac("sha256", key).update(previous).digest());
    for (let index = 0; index < PASSWORD_KEY_BYTES; index += 1) {
      accumulator[index] ^= previous[index];
    }
    completedIterations += 1;
    performedIterations += 1;
  }

  return { completedIterations, previous, accumulator } satisfies OrganizationPasswordPbkdf2ChunkState;
}

/**
 * Standards-equivalent PBKDF2-HMAC-SHA-256 for runtimes whose native PBKDF2
 * primitive enforces a lower iteration ceiling than our accepted 600k policy.
 */
export async function deriveOrganizationPasswordPbkdf2Portable(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  let state: OrganizationPasswordPbkdf2ChunkState | undefined;
  do {
    state = await deriveOrganizationPasswordPbkdf2PortableChunk(password, salt, iterations, state);
  } while (state.completedIterations < iterations);
  return state.accumulator;
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

function readByteArray(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== PASSWORD_KEY_BYTES ||
    value.some((item) => typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    return null;
  }
  return Uint8Array.from(value as number[]);
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
    response = await fetchOrganizationPasswordKdfDurableObjectWithRetry(stub, INTERNAL_KDF_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_KDF_HEADER]: "1",
      },
      body: JSON.stringify({
        password,
        salt: Array.from(salt),
        iterations,
      }),
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
  const derivedKey = readByteArray((payload as Record<string, unknown>).derivedKey);
  if (!derivedKey) throw new OrganizationPasswordKdfUnavailableError("invalid_response");
  return derivedKey;
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
export const ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS = PASSWORD_PBKDF2_CHUNK_ITERATIONS;

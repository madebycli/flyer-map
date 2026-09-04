import {
  deriveOrganizationPasswordPbkdf2PortableChunk,
  ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS,
  ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER,
  type OrganizationPasswordKdfNamespace,
  type OrganizationPasswordPbkdf2ChunkState,
} from "./organizationPasswordKdf.ts";

const MAX_BODY_BYTES = 4_096;
const PASSWORD_KEY_BYTES = 32;
const INTERNAL_CHUNK_URL = "https://organization-password-kdf.internal/chunk";

type OrganizationPasswordKdfDurableObjectEnv = {
  ORGANIZATION_PASSWORD_KDF?: OrganizationPasswordKdfNamespace;
};

function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });
}

function validSalt(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length >= 8 &&
    value.length <= 64 &&
    value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255);
}

function validKeyBytes(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.length === PASSWORD_KEY_BYTES &&
    value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255);
}

function childPartition(salt: Uint8Array) {
  const partition = Array.from(salt, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32) || "default";
  return `chunk:${partition}`;
}

function readChunkState(payload: unknown, priorCompleted: number, iterations: number) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const completedIterations = record.completedIterations;
  const expectedCompleted = Math.min(iterations, priorCompleted + ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS);
  if (
    typeof completedIterations !== "number" ||
    !Number.isInteger(completedIterations) ||
    completedIterations !== expectedCompleted ||
    !validKeyBytes(record.previous) ||
    !validKeyBytes(record.accumulator)
  ) {
    return null;
  }
  return {
    completedIterations,
    previous: Uint8Array.from(record.previous),
    accumulator: Uint8Array.from(record.accumulator),
  } satisfies OrganizationPasswordPbkdf2ChunkState;
}

async function deriveThroughChildDurableObject(
  namespace: OrganizationPasswordKdfNamespace,
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  const child = namespace.get(namespace.idFromName(childPartition(salt)));
  let state: OrganizationPasswordPbkdf2ChunkState | undefined;
  const maxRequests = Math.ceil(iterations / ORGANIZATION_PASSWORD_KDF_CHUNK_ITERATIONS) + 1;

  for (let requestIndex = 0; requestIndex < maxRequests; requestIndex += 1) {
    const priorCompleted = state?.completedIterations ?? 0;
    const response = await child.fetch(INTERNAL_CHUNK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER]: "1",
      },
      body: JSON.stringify({
        password,
        salt: Array.from(salt),
        iterations,
        ...(state ? {
          completedIterations: state.completedIterations,
          previous: Array.from(state.previous),
          accumulator: Array.from(state.accumulator),
        } : {}),
      }),
    });
    if (!response.ok) throw new Error("organization_password_kdf_child_failed");

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("organization_password_kdf_child_invalid_json");
    }
    const next = readChunkState(payload, priorCompleted, iterations);
    if (!next) throw new Error("organization_password_kdf_child_invalid_state");
    state = next;
    if (state.completedIterations === iterations) return state.accumulator;
  }

  throw new Error("organization_password_kdf_child_limit_exceeded");
}

export class OrganizationPasswordKdfDurableObject {
  constructor(_state: unknown, private readonly env: OrganizationPasswordKdfDurableObjectEnv) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isDerive = url.pathname.endsWith("/derive");
    const isChunk = url.pathname.endsWith("/chunk");
    if (
      request.method !== "POST" ||
      (!isDerive && !isChunk) ||
      request.headers.get(ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER) !== "1"
    ) {
      return json({ error: { code: "forbidden", message: "Interne Passwort-Ableitung erforderlich." } }, { status: 403 });
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return json({ error: { code: "payload_too_large", message: "KDF-Request ist zu groß." } }, { status: 413 });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return json({ error: { code: "payload_too_large", message: "KDF-Request ist zu groß." } }, { status: 413 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return json({ error: { code: "invalid_request", message: "KDF-Request ist ungültig." } }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: { code: "invalid_request", message: "KDF-Request ist ungültig." } }, { status: 400 });
    }
    const record = payload as Record<string, unknown>;
    if (
      typeof record.password !== "string" ||
      record.password.length > 256 ||
      !validSalt(record.salt) ||
      typeof record.iterations !== "number" ||
      !Number.isInteger(record.iterations)
    ) {
      return json({ error: { code: "invalid_request", message: "KDF-Parameter sind ungültig." } }, { status: 400 });
    }

    const password = record.password;
    const salt = Uint8Array.from(record.salt);
    const iterations = record.iterations;
    const hasContinuation =
      record.completedIterations !== undefined ||
      record.previous !== undefined ||
      record.accumulator !== undefined;

    if (isDerive) {
      if (hasContinuation) {
        return json({ error: { code: "invalid_request", message: "KDF-Fortsetzung ist nur intern erlaubt." } }, { status: 400 });
      }
      const namespace = this.env.ORGANIZATION_PASSWORD_KDF;
      if (!namespace) {
        return json({ error: { code: "kdf_binding_missing", message: "KDF-Binding ist nicht verfügbar." } }, { status: 503 });
      }
      try {
        const derivedKey = await deriveThroughChildDurableObject(namespace, password, salt, iterations);
        return json({ derivedKey: Array.from(derivedKey) });
      } catch {
        return json({ error: { code: "kdf_failed", message: "Passwort-Ableitung ist fehlgeschlagen." } }, { status: 500 });
      }
    }

    let state: OrganizationPasswordPbkdf2ChunkState | undefined;
    if (hasContinuation) {
      if (
        typeof record.completedIterations !== "number" ||
        !Number.isInteger(record.completedIterations) ||
        !validKeyBytes(record.previous) ||
        !validKeyBytes(record.accumulator)
      ) {
        return json({ error: { code: "invalid_request", message: "KDF-Fortsetzung ist ungültig." } }, { status: 400 });
      }
      state = {
        completedIterations: record.completedIterations,
        previous: Uint8Array.from(record.previous),
        accumulator: Uint8Array.from(record.accumulator),
      };
    }

    try {
      const chunk = await deriveOrganizationPasswordPbkdf2PortableChunk(password, salt, iterations, state);
      return json({
        completedIterations: chunk.completedIterations,
        previous: Array.from(chunk.previous),
        accumulator: Array.from(chunk.accumulator),
      });
    } catch {
      return json({ error: { code: "kdf_failed", message: "Passwort-Ableitung ist fehlgeschlagen." } }, { status: 500 });
    }
  }
}

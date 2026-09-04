import {
  deriveOrganizationPasswordPbkdf2Local,
  ORGANIZATION_PASSWORD_KDF_INTERNAL_HEADER,
} from "./organizationPasswordKdf.ts";

const MAX_BODY_BYTES = 4_096;
const PASSWORD_KEY_BYTES = 32;

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

export class OrganizationPasswordKdfDurableObject {
  constructor(_state: unknown, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      request.method !== "POST" ||
      !url.pathname.endsWith("/derive") ||
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

    try {
      const derived = await deriveOrganizationPasswordPbkdf2Local(
        record.password,
        Uint8Array.from(record.salt),
        record.iterations,
      );
      if (derived.byteLength !== PASSWORD_KEY_BYTES) throw new Error("organization_password_kdf_length_invalid");
      return json({ derivedKey: Array.from(derived) });
    } catch {
      return json({ error: { code: "kdf_failed", message: "Passwort-Ableitung ist fehlgeschlagen." } }, { status: 500 });
    }
  }
}

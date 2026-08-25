import {
  applyCampaignMutation,
  CampaignMutationConflictError,
} from "../src/domain/mutations.ts";
import type { AccessContext } from "./access.ts";
import { authorizeSnapshotWrite } from "./authorization.ts";
import {
  loadCampaignSnapshot,
  type D1DatabaseLike,
} from "./campaignRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import {
  getAppliedMutation,
  persistCampaignMutation,
} from "./mutationRepository.ts";
import { validateCampaignMutation } from "./mutationValidation.ts";
import { validateCampaignSnapshot } from "./snapshotValidation.ts";

const MAX_MUTATION_BYTES = 256_000;
const MAX_PERSIST_ATTEMPTS = 3;

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init.headers,
    },
  });

function errorResponse(
  status: number,
  code: string,
  message: string,
  revision?: number | null,
) {
  return json(
    {
      error: { code, message },
      ...(revision !== undefined ? { revision } : {}),
    },
    { status },
  );
}

async function readMutationBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MUTATION_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Mutation ist zu groß."),
    };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_MUTATION_BYTES) {
    return {
      ok: false as const,
      response: errorResponse(413, "payload_too_large", "Mutation ist zu groß."),
    };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false as const,
        response: errorResponse(400, "invalid_request", "Mutation-Request ist ungültig."),
      };
    }
    return { ok: true as const, value: parsed as Record<string, unknown> };
  } catch {
    return {
      ok: false as const,
      response: errorResponse(400, "invalid_json", "Request-Body ist kein gültiges JSON."),
    };
  }
}

export async function handleCampaignMutation(
  request: Request,
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
) {
  if (request.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "Für Mutationen ist nur POST erlaubt.");
  }
  if (access.role === "viewer") {
    return errorResponse(403, "viewer_read_only", "Read-only Viewer dürfen nichts verändern.");
  }

  const parsed = await readMutationBody(request);
  if (!parsed.ok) return parsed.response;

  const validation = validateCampaignMutation(parsed.value.mutation, campaignId);
  if (!validation.valid) {
    return errorResponse(422, "mutation_invalid", validation.message);
  }
  const mutation = validation.mutation;
  const fingerprint = await fingerprintCampaignMutation(mutation);

  const existing = await getAppliedMutation(db, campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) {
      return errorResponse(
        409,
        "mutation_id_reused",
        "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
        existing.appliedRevision,
      );
    }
    return json({
      mutationId: mutation.id,
      appliedRevision: existing.appliedRevision,
      alreadyApplied: true,
    });
  }

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    const current = await loadCampaignSnapshot(db, campaignId);
    if (!current) {
      return errorResponse(404, "campaign_not_found", "Campaign wurde nicht gefunden.");
    }

    let candidate;
    try {
      candidate = applyCampaignMutation(current, mutation);
    } catch (error) {
      if (error instanceof CampaignMutationConflictError) {
        return errorResponse(
          409,
          "mutation_conflict",
          `Mutation steht im Konflikt mit dem aktuellen Serverstand (${error.reason}).`,
          current.revision,
        );
      }
      throw error;
    }

    const snapshotValidation = validateCampaignSnapshot(candidate, campaignId);
    if (!snapshotValidation.valid) {
      return errorResponse(422, "mutation_invalid", snapshotValidation.message, current.revision);
    }

    const authorization = authorizeSnapshotWrite(access, current, snapshotValidation.snapshot);
    if (!authorization.allowed) {
      return errorResponse(
        403,
        "write_forbidden",
        "Die Änderung liegt außerhalb deiner Berechtigung.",
        current.revision,
      );
    }

    const persisted = await persistCampaignMutation(
      db,
      mutation,
      current.revision,
      fingerprint,
    );
    if (persisted.ok) {
      return json({
        mutationId: mutation.id,
        appliedRevision: persisted.revision,
        alreadyApplied: persisted.alreadyApplied,
      });
    }

    if (persisted.reason === "mutation_id_reused") {
      return errorResponse(
        409,
        "mutation_id_reused",
        "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
        persisted.currentRevision,
      );
    }

    if (attempt === MAX_PERSIST_ATTEMPTS - 1) {
      return errorResponse(
        409,
        "revision_conflict",
        "Der Campaign-Stand wurde gleichzeitig auf einem anderen Gerät geändert.",
        persisted.currentRevision,
      );
    }
  }

  return errorResponse(500, "internal_error", "Mutation konnte nicht verarbeitet werden.");
}

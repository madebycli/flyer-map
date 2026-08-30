import type { AccessContext } from "./access.ts";
import type { D1DatabaseLike } from "./campaignRepository.ts";
import { getAppliedMutation } from "./mutationRepository.ts";
import { fingerprintCampaignMutation } from "./mutationFingerprint.ts";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  handlePickupMutation,
  validatePickupMutation,
} from "./pickupMutationRuntime.ts";

const json = (data: unknown, init: ResponseInit = {}) =>
  Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...init.headers,
    },
  });

export async function handlePickupMutationRequest(
  db: D1DatabaseLike,
  campaignId: string,
  access: AccessContext,
  rawMutation: unknown,
) {
  const validation = validatePickupMutation(rawMutation, campaignId);
  if (!validation.valid) {
    return json(
      { error: { code: "mutation_invalid", message: validation.message } },
      { status: 422 },
    );
  }

  const mutation = validation.mutation;
  const fingerprint = await fingerprintCampaignMutation(
    mutation as unknown as CampaignMutation,
  );
  const existing = await getAppliedMutation(db, campaignId, mutation.id);
  if (existing) {
    if (existing.mutationFingerprint !== fingerprint) {
      return json(
        {
          error: {
            code: "mutation_id_reused",
            message: "Diese Mutation-ID wurde bereits mit anderem Inhalt verwendet.",
          },
          revision: existing.appliedRevision,
        },
        { status: 409 },
      );
    }
    return json({
      mutationId: mutation.id,
      appliedRevision: existing.appliedRevision,
      alreadyApplied: true,
    });
  }

  return handlePickupMutation(db, campaignId, access, mutation);
}

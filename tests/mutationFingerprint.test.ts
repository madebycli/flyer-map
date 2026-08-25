import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignMutation } from "../src/domain/mutations.ts";
import {
  canonicalMutationJson,
  fingerprintCampaignMutation,
} from "../worker/mutationFingerprint.ts";

function firstMutation(): CampaignMutation {
  return {
    id: "mutation_fingerprint-1",
    campaignId: "campaign_fingerprint-test",
    type: "campaign.rename",
    payload: { name: "Neu", expectedName: "Alt" },
    baseRevision: 4,
    createdAt: "2026-08-25T14:00:00.000Z",
  };
}

test("canonical mutation fingerprint is stable across object key insertion order", async () => {
  const first = firstMutation();
  const second = {
    createdAt: first.createdAt,
    baseRevision: first.baseRevision,
    payload: {
      expectedName: first.payload.expectedName,
      name: first.payload.name,
    },
    type: first.type,
    campaignId: first.campaignId,
    id: first.id,
  } as CampaignMutation;

  assert.equal(canonicalMutationJson(first), canonicalMutationJson(second));
  assert.equal(
    await fingerprintCampaignMutation(first),
    await fingerprintCampaignMutation(second),
  );
});

test("mutation fingerprint changes when payload content changes", async () => {
  const first = firstMutation();
  const changed: CampaignMutation = {
    ...first,
    payload: { ...first.payload, name: "Anderer Inhalt" },
  };

  assert.notEqual(
    await fingerprintCampaignMutation(first),
    await fingerprintCampaignMutation(changed),
  );
});

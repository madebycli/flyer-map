import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  normalizeCommentTargetType,
  validateCommentDraft,
} from "../src/domain/commentDraft.ts";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 1,
    campaign: {
      id: "campaign_pickup_comments",
      name: "Pickup Comments",
      status: "active",
      defaultMapView: null,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:00:00.000Z",
    },
    teams: [],
    areas: [],
    tasks: [],
    collection: {
      mainArea: null,
      areas: [],
      runs: [],
      pickups: [
        {
          id: "collection_pickup_comment",
          campaignId: "campaign_pickup_comments",
          areaId: null,
          title: "Abholung",
          address: "Hauptstraße 1",
          description: "",
          position: [10, 50],
          status: "open",
          archivedAt: null,
          assignedRunIds: [],
          assignedCollectorIds: [],
          source: null,
          createdBy: { kind: "campaign-grant", ref: "grant_admin" },
          updatedBy: { kind: "campaign-grant", ref: "grant_admin" },
          createdAt: "2026-08-30T12:00:00.000Z",
          updatedAt: "2026-08-30T12:00:00.000Z",
        },
      ],
    },
  };
}

test("Pickup comment draft preparation only accepts an existing Pickup target", () => {
  const result = validateCommentDraft(snapshot(), {
    campaignId: "campaign_pickup_comments",
    target: { type: "pickup-task", id: "collection_pickup_comment" },
    body: "Abholung bitte anrufen",
  });
  assert.equal(result.valid, true);

  assert.deepEqual(
    validateCommentDraft(snapshot(), {
      campaignId: "campaign_pickup_comments",
      target: { type: "pickup-task", id: "collection_pickup_missing" },
      body: "Text",
    }),
    { valid: false, reason: "target-not-found" },
  );
});

test("Pickup comment persistence remains disabled until an additive runtime migration exists", () => {
  assert.equal(normalizeCommentTargetType("pickup-task"), null);
});

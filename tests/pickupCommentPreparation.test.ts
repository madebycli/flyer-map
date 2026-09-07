import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("Pickup comments use the persistent target only after forward migration 0013", () => {
  assert.equal(normalizeCommentTargetType("pickup-task"), "pickup-task");
  const migration = readFileSync(
    new URL("../migrations/0013_fc5_pickup_comments.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /pickup-task/u);
  assert.match(migration, /collection-collector/u);
  assert.match(migration, /INSERT INTO comments_fc5_next/u);
  assert.match(migration, /INSERT INTO domain_events_fc5_next/u);
});

test("normal Pickup UI reuses the durable CommentsContextPanel", () => {
  const panel = readFileSync(new URL("../src/collection/PickupPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /CommentsContextPanel/u);
  assert.match(panel, /targetType="pickup-task"/u);
  assert.match(panel, /commentPickup\.id/u);
});

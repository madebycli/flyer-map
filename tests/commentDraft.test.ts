import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { validateCommentDraft } from "../src/domain/commentDraft.ts";

function snapshotFixture(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 1,
    campaign: {
      id: "campaign_comments",
      name: "Kommentare",
      status: "active",
      defaultMapView: null,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    },
    teams: [
      {
        id: "team_comments",
        campaignId: "campaign_comments",
        name: "Team",
        color: "#ea580c",
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
      },
    ],
    areas: [
      {
        id: "area_comments",
        campaignId: "campaign_comments",
        teamId: "team_comments",
        name: "Gebiet",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10, 50],
              [10.1, 50],
              [10.1, 50.1],
              [10, 50],
            ],
          ],
        },
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
      },
    ],
    tasks: [
      {
        id: "task_comments",
        campaignId: "campaign_comments",
        areaId: "area_comments",
        taskType: "street",
        label: "Straße",
        geometry: {
          type: "LineString",
          coordinates: [
            [10, 50],
            [10.1, 50.1],
          ],
        },
        status: "open",
        completedAt: null,
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
      },
    ],
  };
}

test("comments can target existing Campaign, Area and Task context", () => {
  const snapshot = snapshotFixture();
  for (const target of [
    { type: "campaign", id: "campaign_comments" },
    { type: "area", id: "area_comments" },
    { type: "task", id: "task_comments" },
  ] as const) {
    const result = validateCommentDraft(snapshot, {
      campaignId: "campaign_comments",
      target,
      body: "Hinweis für diesen Kontext",
    });
    assert.equal(result.valid, true);
  }
});

test("comments cannot attach to a missing or cross-campaign target", () => {
  const snapshot = snapshotFixture();
  assert.deepEqual(
    validateCommentDraft(snapshot, {
      campaignId: "campaign_other",
      target: { type: "campaign", id: "campaign_other" },
      body: "Text",
    }),
    { valid: false, reason: "invalid-campaign" },
  );
  assert.deepEqual(
    validateCommentDraft(snapshot, {
      campaignId: "campaign_comments",
      target: { type: "task", id: "task_missing" },
      body: "Text",
    }),
    { valid: false, reason: "target-not-found" },
  );
});

test("code-like comment text remains inert text", () => {
  const hostile = "<img src=x onerror=alert(1)> x'); DROP TABLE comments; --";
  const result = validateCommentDraft(snapshotFixture(), {
    campaignId: "campaign_comments",
    target: { type: "area", id: "area_comments" },
    body: hostile,
  });

  assert.equal(result.valid, true);
  if (result.valid) assert.equal(result.value.body, hostile);
});

test("comments enforce a narrow body size without collecting profile data", () => {
  assert.deepEqual(
    validateCommentDraft(snapshotFixture(), {
      campaignId: "campaign_comments",
      target: { type: "area", id: "area_comments" },
      body: "   ",
    }),
    { valid: false, reason: "invalid-body" },
  );
  assert.deepEqual(
    validateCommentDraft(snapshotFixture(), {
      campaignId: "campaign_comments",
      target: { type: "area", id: "area_comments" },
      body: "x".repeat(2_001),
    }),
    { valid: false, reason: "invalid-body" },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  actionRunDraftFromTemplate,
  actionTemplateFromCampaign,
} from "../src/domain/actionTemplate.ts";

const snapshot: CampaignSnapshot = {
  schemaVersion: 3,
  revision: 14,
  campaign: {
    id: "campaign_old",
    name: "Frühjahr 2026",
    status: "archived",
    defaultMapView: { center: [8.4, 49.0], zoom: 15, bearing: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  },
  teams: [
    {
      id: "team_old",
      campaignId: "campaign_old",
      name: "Orange",
      color: "#ea580c",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  areas: [
    {
      id: "area_old",
      campaignId: "campaign_old",
      teamId: "team_old",
      name: "Nord",
      geometry: {
        type: "Polygon",
        coordinates: [[[8.4, 49.0], [8.41, 49.0], [8.41, 49.01], [8.4, 49.0]]],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  tasks: [
    {
      id: "task_old",
      campaignId: "campaign_old",
      areaId: "area_old",
      taskType: "street",
      label: "Beispielweg",
      geometry: { type: "LineString", coordinates: [[8.4, 49.0], [8.41, 49.0]] },
      status: "completed",
      completedAt: "2026-03-12T12:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-03-12T12:00:00.000Z",
    },
  ],
};

test("template keeps reusable planning but drops campaign ids and operational completion state", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Kleidersammlung");
  const serialized = JSON.stringify(template);

  assert.equal(template.name, "Standard Kleidersammlung");
  assert.equal(template.teams[0].name, "Orange");
  assert.equal(template.areas[0].teamKey, "team-1");
  assert.equal(template.streetSections[0].areaKey, "area-1");
  assert.equal(serialized.includes("campaign_old"), false);
  assert.equal(serialized.includes("task_old"), false);
  assert.equal(serialized.includes("completedAt"), false);
  assert.equal(serialized.includes('"completed"'), false);
});

test("distribution run starts every planned street section open", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Kleidersammlung");
  const run = actionRunDraftFromTemplate(template, "distribution");

  assert.equal(run.mode, "distribution");
  assert.equal(run.distributionTasks.length, 1);
  assert.equal(run.distributionTasks[0].status, "open");
  assert.equal(run.collectionReferenceSections.length, 0);
  assert.deepEqual(run.pickupTasks, []);
});

test("collection run reuses planning context but starts with no pickup tasks", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Kleidersammlung");
  const run = actionRunDraftFromTemplate(template, "collection");

  assert.equal(run.mode, "collection");
  assert.equal(run.distributionTasks.length, 0);
  assert.equal(run.collectionReferenceSections.length, 1);
  assert.deepEqual(run.pickupTasks, []);
});

test("template extraction validates the display name", () => {
  assert.throws(() => actionTemplateFromCampaign(snapshot, "   "), /invalid_template_name/u);
  assert.throws(() => actionTemplateFromCampaign(snapshot, "x".repeat(161)), /invalid_template_name/u);
});

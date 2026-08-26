import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import {
  actionRunDraftFromTemplate,
  actionTemplateFilename,
  actionTemplateFromCampaign,
  createCollectionActionTemplate,
  parseActionTemplateFile,
  serializeActionTemplate,
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

test("distribution template keeps reusable settings but drops old operational identity/state", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Flyer");
  const serialized = JSON.stringify(template);

  assert.equal(template.mode, "distribution");
  assert.equal(template.name, "Standard Flyer");
  assert.equal(template.operationalDefaults.fieldGroupDiscoverableByDefault, true);
  assert.equal(template.teams[0].name, "Orange");
  assert.equal(template.areas[0].teamKey, "team-1");
  assert.equal(template.roadSections[0].areaKey, "area-1");
  assert.equal(serialized.includes("campaign_old"), false);
  assert.equal(serialized.includes("task_old"), false);
  assert.equal(serialized.includes("completedAt"), false);
  assert.equal(serialized.includes('"completed"'), false);
});

test("distribution draft starts every planned road section open", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Flyer");
  const run = actionRunDraftFromTemplate(template);

  assert.equal(run.mode, "distribution");
  assert.equal(run.distributionTasks.length, 1);
  assert.equal(run.distributionTasks[0].status, "open");
  assert.equal(run.collectionRoadSections.length, 0);
  assert.deepEqual(run.pickupTasks, []);
});

test("collection template has its own car teams and smaller collection areas", () => {
  const template = createCollectionActionTemplate({
    name: "Standard Abholung",
    defaultMapView: { center: [8.4, 49.0], zoom: 15.5, bearing: 0 },
    operationalDefaults: { fieldGroupDiscoverableByDefault: true },
    teams: [
      { key: "car-1", name: "Auto 1", color: "#2563eb" },
      { key: "car-2", name: "Auto 2", color: "#15803d" },
    ],
    areas: [
      {
        key: "pickup-a",
        teamKey: "car-1",
        name: "Abholung Nord-West",
        geometry: {
          type: "Polygon",
          coordinates: [[[8.4, 49.0], [8.405, 49.0], [8.405, 49.005], [8.4, 49.0]]],
        },
      },
      {
        key: "pickup-b",
        teamKey: "car-2",
        name: "Abholung Nord-Ost",
        geometry: {
          type: "Polygon",
          coordinates: [[[8.405, 49.0], [8.41, 49.0], [8.41, 49.005], [8.405, 49.0]]],
        },
      },
    ],
    roadSections: [],
  });
  const run = actionRunDraftFromTemplate(template);

  assert.equal(run.mode, "collection");
  assert.deepEqual(run.distributionTasks, []);
  assert.deepEqual(run.collectionRoadSections, []);
  assert.equal(run.teams.length, 2);
  assert.equal(run.areas.length, 2);
  assert.deepEqual(run.pickupTasks, []);
});

test("template file round-trip is strict and portable", () => {
  const template = actionTemplateFromCampaign(snapshot, "Frühjahr Standard");
  const file = serializeActionTemplate(template);
  const parsed = parseActionTemplateFile(file);

  assert.deepEqual(parsed, template);
  assert.equal(actionTemplateFilename(template), "Fruhjahr-Standard.flyer-map-template.json");
  assert.throws(() => parseActionTemplateFile("not json"), /invalid_template_file/u);
  assert.throws(
    () => parseActionTemplateFile(JSON.stringify({ format: "other", fileVersion: 1, template })),
    /unsupported_template_file/u,
  );
});

test("template import rejects broken cross references instead of partially loading", () => {
  const template = actionTemplateFromCampaign(snapshot, "Standard Flyer");
  const broken = structuredClone(template);
  broken.areas[0].teamKey = "missing-team";

  assert.throws(
    () => parseActionTemplateFile(JSON.stringify({ format: "flyer-map-action-template", fileVersion: 1, template: broken })),
    /invalid_template_file/u,
  );
});

test("template extraction validates the display name", () => {
  assert.throws(() => actionTemplateFromCampaign(snapshot, "   "), /invalid_template_name/u);
  assert.throws(() => actionTemplateFromCampaign(snapshot, "x".repeat(161)), /invalid_template_name/u);
});

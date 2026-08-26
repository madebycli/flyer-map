import assert from "node:assert/strict";
import test from "node:test";
import { parseActionTemplateFile } from "../src/domain/actionTemplate.ts";

const validTemplate = {
  schemaVersion: 2,
  mode: "distribution",
  name: "Portable Vorlage",
  defaultMapView: null,
  operationalDefaults: { fieldGroupDiscoverableByDefault: true },
  teams: [{ key: "team-1", name: "Orange", color: "#ea580c" }],
  areas: [
    {
      key: "area-1",
      teamKey: "team-1",
      name: "Nord",
      geometry: {
        type: "Polygon",
        coordinates: [[[8, 49], [8.01, 49], [8.01, 49.01], [8, 49]]],
      },
    },
  ],
  roadSections: [],
};

test("template import normalizes onto the allowlisted schema and drops unrelated extra fields", () => {
  const imported = parseActionTemplateFile(JSON.stringify({
    format: "flyer-map-action-template",
    fileVersion: 1,
    template: {
      ...validTemplate,
      oldCampaignId: "campaign_old",
      previousCompletion: "completed",
      legacyAccessValue: "should-not-survive",
      teams: [
        {
          ...validTemplate.teams[0],
          oldTeamId: "team_old",
          unrelatedMetadata: "drop-me",
        },
      ],
    },
  }));

  assert.deepEqual(Object.keys(imported).sort(), [
    "areas",
    "defaultMapView",
    "mode",
    "name",
    "operationalDefaults",
    "roadSections",
    "schemaVersion",
    "teams",
  ]);
  assert.deepEqual(Object.keys(imported.teams[0]).sort(), ["color", "key", "name"]);
  assert.equal(JSON.stringify(imported).includes("campaign_old"), false);
  assert.equal(JSON.stringify(imported).includes("should-not-survive"), false);
  assert.equal(JSON.stringify(imported).includes("team_old"), false);
});

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
  roadSections: [
    {
      key: "road-1",
      areaKey: "area-1",
      label: "Hauptstraße",
      geometry: {
        type: "LineString",
        coordinates: [[8, 49], [8.01, 49.01]],
      },
    },
  ],
};

test("template import normalizes nested Team, Area and Road objects onto allowlisted fields", () => {
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
          unrelatedTeamMetadata: "drop-team",
        },
      ],
      areas: [
        {
          ...validTemplate.areas[0],
          oldAreaId: "area_old",
          previousAreaCompletion: "completed",
          unrelatedAreaMetadata: "drop-area",
        },
      ],
      roadSections: [
        {
          ...validTemplate.roadSections[0],
          oldTaskId: "task_old",
          previousRoadStatus: "completed",
          unrelatedRoadMetadata: "drop-road",
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
  assert.deepEqual(Object.keys(imported.areas[0]).sort(), ["geometry", "key", "name", "teamKey"]);
  assert.deepEqual(Object.keys(imported.roadSections[0]).sort(), ["areaKey", "geometry", "key", "label"]);

  const normalized = JSON.stringify(imported);
  for (const forbidden of [
    "campaign_old",
    "should-not-survive",
    "team_old",
    "drop-team",
    "area_old",
    "completed",
    "drop-area",
    "task_old",
    "drop-road",
  ]) {
    assert.equal(normalized.includes(forbidden), false, `${forbidden} must not survive import`);
  }
});

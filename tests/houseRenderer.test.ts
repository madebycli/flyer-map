import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HOUSE_FILL_LAYER_ID,
  HOUSE_LAYER_IDS,
  HOUSE_LATER_LAYER_ID,
  HOUSE_MIN_ZOOM,
  HOUSE_NOT_DELIVERABLE_LAYER_ID,
  HOUSE_OUTLINE_LAYER_ID,
  HOUSE_SELECTED_LAYER_ID,
  HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
  HOUSE_SOURCE_ID,
  housesToGeoJson,
  type RenderHouse,
} from "../src/map/houseRenderer.ts";

const house: RenderHouse = {
  id: "task_house-renderer-1",
  campaignId: "campaign_renderer",
  areaId: "area_renderer",
  taskType: "house",
  label: "Hauptstraße 12",
  geometry: {
    type: "Polygon",
    coordinates: [[[10, 50], [10.001, 50], [10.001, 50.001], [10, 50]]],
  },
  source: {
    dataset: "OpenStreetMap",
    objectType: "way",
    objectIds: [501],
  },
  parentStreetTaskId: "task_street-1",
  status: "later",
  completedAt: null,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
  color: "#2563eb",
  completedColor: "#1c4ab0",
};

test("housesToGeoJson keeps app identity and reviewed Polygon geometry", () => {
  const result = housesToGeoJson([house]);
  assert.equal(result.type, "FeatureCollection");
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].id, house.id);
  assert.equal(result.features[0].properties.houseTaskId, house.id);
  assert.equal(result.features[0].properties.status, "later");
  assert.equal(result.features[0].properties.color, house.color);
  assert.equal(result.features[0].properties.completedColor, house.completedColor);
  assert.deepEqual(result.features[0].geometry, house.geometry);
  assert.notEqual(result.features[0].id, String(house.source?.objectIds[0]));
});

test("House GeoJSON properties exclude provenance and unrelated domain data", () => {
  const result = housesToGeoJson([house]);
  assert.deepEqual(Object.keys(result.features[0].properties).sort(), [
    "color",
    "completedColor",
    "houseTaskId",
    "status",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /OpenStreetMap|501|Hauptstraße|parentStreetTaskId|createdAt/u);
});

test("empty or legacy snapshots produce an empty House FeatureCollection", () => {
  assert.deepEqual(housesToGeoJson([]), { type: "FeatureCollection", features: [] });
});

test("House renderer uses a fixed layer set and starts at the central zoom boundary", () => {
  assert.equal(HOUSE_SOURCE_ID, "vf-houses");
  assert.equal(HOUSE_MIN_ZOOM, 15);
  assert.deepEqual(HOUSE_LAYER_IDS, [
    HOUSE_FILL_LAYER_ID,
    HOUSE_OUTLINE_LAYER_ID,
    HOUSE_LATER_LAYER_ID,
    HOUSE_NOT_DELIVERABLE_LAYER_ID,
    HOUSE_SESSION_HIGHLIGHT_LAYER_ID,
    HOUSE_SELECTED_LAYER_ID,
  ]);
  assert.equal(new Set(HOUSE_LAYER_IDS).size, HOUSE_LAYER_IDS.length);
});

test("House conversion stays batched across the required dense dataset sizes", () => {
  for (const count of [1_000, 2_500, 5_000, 10_000, 20_000]) {
    const houses = Array.from({ length: count }, (_, index) => ({
      ...house,
      id: `task_house-renderer-${index}`,
    }));
    const result = housesToGeoJson(houses);
    assert.equal(result.features.length, count);
    assert.equal(result.features.at(-1)?.properties.houseTaskId, `task_house-renderer-${count - 1}`);
  }
  assert.equal(HOUSE_LAYER_IDS.length, 6);
});

test("MapView keeps House data updates separate from selection and camera work", async () => {
  const source = await readFile("src/map/MapView.tsx", "utf8");
  assert.match(source, /\[HOUSE_SOURCE_ID\]:\s*\{[\s\S]*?data: housesToGeoJson\(\[\]\)/u);
  assert.match(source, /function syncHouseData\([\s\S]*?houseSource\.setData\(housesToGeoJson\(houses\)\)/u);
  assert.match(source, /function syncApplicationFilters\([\s\S]*?HOUSE_SELECTED_LAYER_ID[\s\S]*?HOUSE_SESSION_HIGHLIGHT_LAYER_ID/u);
  assert.match(source, /const houseFeatures = map\.queryRenderedFeatures\(bbox,\s*\{\s*layers: \[HOUSE_FILL_LAYER_ID\]/u);
  assert.equal(source.includes("syncApplicationData("), false);
  assert.ok(source.indexOf("const streetFeatures") < source.indexOf("const houseFeatures"));
  assert.ok(source.indexOf("const houseFeatures") < source.indexOf("const areaFeatures"));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { SmartBuildingCandidate } from "../src/domain/smartCandidates.ts";
import { smartHouseBuildingsToGeoJson } from "../src/map/smartHouseCandidateData.ts";

function building(index: number): SmartBuildingCandidate {
  const offset = index / 100_000;
  return {
    sourceId: `way/${10_000 + index}`,
    osmId: 10_000 + index,
    buildingType: "house",
    houseNumber: String(index + 1),
    street: "Kartenstraße",
    postcode: "12345",
    city: "Teststadt",
    geometry: {
      type: "Polygon",
      coordinates: [[
        [10 + offset, 50],
        [10.0005 + offset, 50],
        [10.0005 + offset, 50.0005],
        [10 + offset, 50],
      ]],
    },
  };
}

test("normal Smart House flow uses real package candidates and never the workbench preview graph", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const panel = await readFile("src/map/SmartHouseSelectionPanel.tsx", "utf8");
  const combined = `${app}\n${map}\n${panel}`;

  assert.match(app, /smartCandidatesForArea/u);
  assert.match(app, /availableSmartBuildingsForCreation/u);
  assert.match(app, /setMode\("smart-house"\)/u);
  assert.match(app, /createSmartHouseTaskSnapshot/u);
  assert.match(app, /parentStreetTaskId: smartHouseParentStreetTaskId/u);
  assert.doesNotMatch(combined, /PREVIEW_BUILDINGS|Mock Buildings|M6SelectionPreview/u);
});

test("Smart House MapLibre path has fixed layers, fill-only hit testing, and explicit selection filters", async () => {
  const map = await readFile("src/map/MapView.tsx", "utf8");

  assert.match(map, /SMART_HOUSE_SOURCE_ID = "vf-smart-house-candidates"/u);
  assert.match(map, /SMART_HOUSE_FILL_LAYER_ID/u);
  assert.match(map, /SMART_HOUSE_OUTLINE_LAYER_ID/u);
  assert.match(map, /SMART_HOUSE_SELECTED_LAYER_ID/u);
  assert.match(map, /map\.queryRenderedFeatures\(bbox, \{ layers: \[SMART_HOUSE_FILL_LAYER_ID\] \}\)/u);
  assert.match(map, /interaction\.onSmartHousePoint\(lngLat, sourceIds\)/u);
  assert.match(map, /source\.setData\(smartHouseBuildingsToGeoJson\(buildings\)\)/u);
  assert.match(map, /map\.setFilter\(\s*SMART_HOUSE_SELECTED_LAYER_ID/u);
  assert.doesNotMatch(map, /smartHouse.*queryRenderedFeatures\(bbox, \{ layers: \[SMART_HOUSE_OUTLINE_LAYER_ID/u);
});

test("candidate serialization stays one bounded GeoJSON source without OSM identity properties", () => {
  for (const count of [1_000, 5_000, 10_000, 20_000]) {
    const data = smartHouseBuildingsToGeoJson(Array.from({ length: count }, (_, index) => building(index)));
    assert.equal(data.features.length, count);
    assert.deepEqual(Object.keys(data.features[0].properties).sort(), ["sourceId", "style"]);
    assert.equal(data.features[0].id, "way/10000");
  }
});

test("Smart House review renders only selected rows and bounded street shortcuts", async () => {
  const panel = await readFile("src/map/SmartHouseSelectionPanel.tsx", "utf8");
  assert.match(panel, /selectedBuildings\.map/u);
  assert.match(panel, /smartBuildingStreetOptions\(buildings\)/u);
  assert.match(panel, /HOUSE_CREATE_BATCH_MAX/u);
  assert.doesNotMatch(panel, /buildings\.map\(\(building\) => \{/u);
});

test("house batch mutation stays on the existing M5 queue and preserves App identity", async () => {
  const mutations = await readFile("src/domain/mutations.ts", "utf8");
  const diff = await readFile("src/domain/mutationDiff.ts", "utf8");
  const baseDiff = await readFile("src/domain/mutationDiffBase.ts", "utf8");
  const repository = await readFile("worker/mutationRepository.ts", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(mutations, /"house\.create-batch"/u);
  assert.match(mutations, /HOUSE_CREATE_BATCH_MAX = 50/u);
  assert.match(diff, /mutationDiffBase\.ts/u);
  assert.match(baseDiff, /type: "house\.create-batch"/u);
  assert.match(repository, /FROM json_each\(\?\)/u);
  assert.match(repository, /INSERT INTO house_tasks/u);
  assert.match(store, /postCampaignMutation\(campaignId, record\.mutation\)/u);
  assert.match(store, /schema_migration_required/u);
});

test("parent Street context is passed explicitly and no addr:street inference is introduced", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const selection = await readFile("src/domain/smartBuildingSelection.ts", "utf8");
  assert.match(app, /startSmartHouseSelection\(selectedTask\.id\)/u);
  assert.match(app, /parentStreetTaskId: smartHouseParentStreetTaskId/u);
  assert.doesNotMatch(`${app}\n${selection}`, /addr:street.*parent|parent.*addr:street/iu);
});

test("Smart House keeps cancel, permission, duplicate-submit and existing retry boundaries", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(app, /if \(!selectedArea \|\| !canEditSelectedArea/u);
  assert.match(app, /const pkg = await ensureSmartMapPackage\("buildings"\)/u);
  assert.match(app, /smartHouseMapPackage/u);
  assert.match(app, /smartHouseLoading/u);
  assert.match(app, /aria-busy=\{smartHouseLoading\}/u);
  assert.match(app, /const cancelSmartHouseSelection/u);
  assert.match(app, /smartHouseSaveInFlight\.current/u);
  assert.match(app, /setSheet\("task"\)/u);
  assert.match(store, /state: "retry"/u);
  assert.match(store, /messageCode: "schema_migration_required"/u);
});

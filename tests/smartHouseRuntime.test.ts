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

test("normal Area flow has no browser Smart House entry and no workbench preview graph", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const panel = await readFile("src/map/SmartHouseSelectionPanel.tsx", "utf8");
  const combined = `${app}\n${map}\n${panel}`;

  assert.doesNotMatch(app, /createAreaPreparationPoller|fetchAreaPreparation|startAreaPreparation/u);
  assert.doesNotMatch(app, /smartCandidatesForArea|availableSmartBuildingsForCreation|setMode\("smart-house"\)|createSmartHouseTaskSnapshot/u);
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

test("house batch mutation stays on the normal App identity and enters RxDB locally", async () => {
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
  assert.match(store, /runtime\.sync\.applyMutation\(mutation\)/u);
  assert.doesNotMatch(store, /processMutationQueue\(/u);
  assert.match(store, /schema_migration_required/u);
});

test("automatic House status has no addr:street inference or manual Smart House entry", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const selection = await readFile("src/domain/smartBuildingSelection.ts", "utf8");
  assert.match(app, /changeHouseTaskStatus/u);
  assert.match(app, /canChangeSelectedHouseTaskStatus/u);
  assert.doesNotMatch(app, /startSmartHouseSelection|smartHouseParentStreetTaskId/u);
  assert.doesNotMatch(`${app}\n${selection}`, /addr:street.*parent|parent.*addr:street/iu);
});

test("automatic House Tasks keep normal status controls and isolated RxDB retry boundaries", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(app, /selectedHouseTask\.status === status/u);
  assert.match(app, /disabled=\{!canChangeSelectedHouseTaskStatus\}/u);
  assert.match(app, /selectedTaskIsAutoPrepared/u);
  assert.doesNotMatch(app, /ensureSmartMapPackage|smartHouseMapPackage|smartHouseLoading|cancelSmartHouseSelection/u);
  assert.match(store, /schema_unavailable/u);
  assert.match(store, /reportRxdbIssue/u);
  assert.match(store, /schema_migration_required/u);
});

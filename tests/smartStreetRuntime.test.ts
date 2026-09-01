import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("normal Area flow uses server preparation and keeps no browser Smart Street entry", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const offline = await readFile("src/data/offlineMapRepository.ts", "utf8");
  const combined = `${app}\n${map}\n${offline}`;

  assert.match(app, /createAreaPreparationPoller/u);
  assert.match(app, /fetchAreaPreparation/u);
  assert.match(app, /startAreaPreparation/u);
  assert.match(app, /addManualStreet/u);
  assert.doesNotMatch(app, /smartCandidatesForArea|smartRoadMapPackage|smartMapRequestRef|setMode\("smart-street"\)/u);
  assert.doesNotMatch(combined, /PREVIEW_ROADS|Mock Roads|M6SelectionPreview/u);
});

test("MapLibre receives real candidate clicks and renders candidate, preview, and anchor states", async () => {
  const map = await readFile("src/map/MapView.tsx", "utf8");

  assert.match(map, /SMART_ROAD_SOURCE_ID = "vf-smart-street-candidates"/u);
  assert.match(map, /SMART_ROAD_SELECTED_LAYER_ID/u);
  assert.match(map, /SMART_PREVIEW_SOURCE_ID = "vf-smart-street-preview"/u);
  assert.match(map, /SMART_POINT_SOURCE_ID = "vf-smart-street-points"/u);
  assert.match(map, /map\.queryRenderedFeatures\(bbox, \{ layers: smartLayers \}\)/u);
  assert.match(map, /interaction\.onSmartStreetPoint\(lngLat, sourceIds\)/u);
  assert.match(map, /roadSource\.setData\(smartRoadsToGeoJson/u);
  assert.match(map, /previewSource\.setData\(smartPreviewToGeoJson/u);
  assert.match(map, /pointSource\.setData\(smartPointsToGeoJson/u);
  assert.match(map, /offlineMapPackageChangeRef\.current\?\.\(pkg\)/u);
  assert.doesNotMatch(map, /\.osmId/u);
});

test("automatic Street Tasks use the durable normal task and mutation path", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const diff = await readFile("src/domain/mutationDiff.ts", "utf8");
  const baseDiff = await readFile("src/domain/mutationDiffBase.ts", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(app, /areaPreparationGeneration: null/u);
  assert.match(app, /selectedTaskIsAutoPrepared/u);
  assert.match(app, /selectedTask\.areaPreparationGeneration/u);
  assert.match(diff, /mutationDiffBase\.ts/u);
  assert.match(baseDiff, /\.\.\.\(task\.source \? \{ source: task\.source \} : \{\}\)/u);
  assert.match(store, /postCampaignMutation\(campaignId, record\.mutation\)/u);
});

test("Area preparation keeps its existing Area permissions and bounded retry", async () => {
  const app = await readFile("src/App.tsx", "utf8");

  assert.match(app, /if \(!selectedArea \|\| !canEditSelectedArea\) return/u);
  assert.match(app, /areaPreparationPollerRef\.current\?\.retry\(\)/u);
  assert.match(app, /areaPreparationSchemaUnavailable/u);
  assert.match(app, /areaPreparationRequestFailed/u);
  assert.match(app, /canAutoStart: \(\) => !areaPreparationAutoStartKeys\.current\.has/u);
  assert.doesNotMatch(app, /ensureSmartMapPackage|fetchMapDataPackage|smartRoadMapPackage/u);
});

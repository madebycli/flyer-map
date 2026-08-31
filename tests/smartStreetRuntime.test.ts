import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("normal Area flow uses prepared OSM candidates and not the M6 preview graph", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const offline = await readFile("src/data/offlineMapRepository.ts", "utf8");
  const combined = `${app}\n${map}\n${offline}`;

  assert.match(app, /smartCandidatesForArea/u);
  assert.match(app, /onOfflineMapPackageChange=\{setOfflineMapPackage\}/u);
  assert.match(app, /setMode\("smart-street"\)/u);
  assert.match(app, /smartRoadPointAnchorCandidates/u);
  assert.match(app, /selectSmartRoadRange/u);
  assert.match(app, /selectSmartRoadRangeViaWaypoints/u);
  assert.match(app, /smartRoadRouteOptions/u);
  assert.match(app, /createSmartStreetTaskSnapshot/u);
  assert.match(app, /smartStreetPendingAnchors/u);
  assert.match(app, /smartStreetSaveInFlight/u);
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

test("Smart Street save keeps App identity and uses the durable mutation path", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  const diff = await readFile("src/domain/mutationDiff.ts", "utf8");
  const baseDiff = await readFile("src/domain/mutationDiffBase.ts", "utf8");
  const store = await readFile("src/data/campaignStore.ts", "utf8");

  assert.match(app, /taskId: createId\("task"\)/u);
  assert.match(app, /sourceIds: smartStreetSelectedSourceIds/u);
  assert.match(app, /commitSnapshot\(\(current\) => \(\{ \.\.\.current, tasks: \[\.\.\.current\.tasks, task\] \}\)\)/u);
  assert.match(app, /smartStreetSaveInFlight\.current/u);
  assert.match(diff, /mutationDiffBase\.ts/u);
  assert.match(baseDiff, /\.\.\.\(task\.source \? \{ source: task\.source \} : \{\}\)/u);
  assert.match(store, /postCampaignMutation\(campaignId, record\.mutation\)/u);
});

test("Smart Street UI keeps editing permissions at the existing Area boundary", async () => {
  const app = await readFile("src/App.tsx", "utf8");

  assert.match(app, /const startSmartStreetSelection = async/u);
  assert.match(app, /if \(!selectedArea \|\| !canEditSelectedArea\) return/u);
  assert.match(app, /const pkg = await ensureSmartMapPackage\(\)/u);
  assert.match(app, /fetchMapDataPackage/u);
  assert.match(app, /disabled=\{smartMapLoading\}/u);
  assert.match(app, /!canEditSelectedArea/u);
  assert.match(app, /setSmartStreetMessage\(t\(language, "smartStreetDisconnected"\)\)/u);
});

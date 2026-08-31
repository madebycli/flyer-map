import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MapView installs OpenFreeMap Liberty and one constant housenumber layer", async () => {
  const map = await readFile("src/map/MapView.tsx", "utf8");
  const diagnostics = await readFile("src/diagnostics/MapDiagnostics.tsx", "utf8");

  assert.match(map, /https:\/\/tiles\.openfreemap\.org\/styles\/liberty/u);
  assert.match(map, /BASEMAP_HOUSENUMBER_LAYER_ID = "vf-basemap-housenumbers"/u);
  assert.match(map, /BASEMAP_VECTOR_SOURCE_ID = "openmaptiles"/u);
  assert.match(map, /BASEMAP_HOUSENUMBER_SOURCE_LAYER = "housenumber"/u);
  assert.match(map, /"text-field": \["get", "housenumber"\]/u);
  assert.match(map, /"text-font": \["Noto Sans Regular"\]/u);
  assert.match(map, /minzoom: 16/u);
  assert.match(map, /providerLayer\["source-layer"\] === BASEMAP_HOUSENUMBER_SOURCE_LAYER/u);
  assert.match(map, /map\.once\("style\.load"/u);
  assert.match(map, /COLLECTION_PICKUP_SOURCE_ID/u);
  assert.match(map, /COLLECTION_PICKUP_MARKER_LAYER_ID/u);
  assert.doesNotMatch(`${map}\n${diagnostics}`, /carto.*cdn|CARTO_BASEMAP_LAYER_ID/u);
});

test("normal app geometry is below Liberty labels and interaction overlays remain above", async () => {
  const map = await readFile("src/map/MapView.tsx", "utf8");
  assert.match(map, /BELOW_BASEMAP_LABEL_LAYER_IDS/u);
  assert.match(map, /AREA_FILL_LAYER_ID/u);
  assert.match(map, /HOUSE_FILL_LAYER_ID/u);
  assert.match(map, /STREET_OPEN_LAYER_ID/u);
  assert.match(map, /COLLECTION_AREAS_FILL_LAYER_ID/u);
  assert.match(map, /map\.addLayer\(layer, firstBasemapSymbolLayerId\)/u);
  assert.match(map, /if \(BELOW_BASEMAP_LABEL_LAYER_IDS\.has\(layer\.id\)\) continue;\s+if \(!map\.getLayer\(layer\.id\)\) map\.addLayer\(layer\)/u);
});

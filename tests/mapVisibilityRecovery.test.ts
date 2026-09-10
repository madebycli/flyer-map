import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("field map keeps the established direct MapLibre Bright-style startup", async () => {
  const mainSource = await readFile("src/main.tsx", "utf8");
  const mapSource = await readFile("src/map/MapView.tsx", "utf8");

  assert.doesNotMatch(mainSource, /mapStyleRecovery|installFieldMapStyleRecovery/);
  assert.match(
    mapSource,
    /export const OPENFREE_MAP_STYLE_URL = "https:\/\/tiles\.openfreemap\.org\/styles\/bright";/,
  );
  assert.match(mapSource, /style:\s*OPENFREE_MAP_STYLE_URL/);
});

test("restoring basemap startup does not remove campaign overlay sources", async () => {
  const mapSource = await readFile("src/map/MapView.tsx", "utf8");

  assert.match(mapSource, /const AREA_SOURCE_ID = "vf-areas";/);
  assert.match(mapSource, /const STREET_SOURCE_ID = "vf-streets";/);
  assert.match(mapSource, /HOUSE_SOURCE_ID/);
});

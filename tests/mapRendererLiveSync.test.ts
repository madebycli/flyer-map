import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");

test("MapLibre live source effects never drop a prop update while style work is pending", () => {
  assert.equal(
    (source.match(/if \(!map \|\| !map\.isStyleLoaded\(\)\) return;/g) ?? []).length,
    0,
  );

  for (const syncCall of [
    "syncAreaData(map, areas);",
    "syncStreetData(map, tasks);",
    "syncHouseData(map, houses);",
    "syncSmartHouseData(map, smartHouseBuildings);",
    "syncSmartHouseSelection(map, smartHouseSelectedSourceIds, mode);",
    "syncCollectionPickupData(map, collectionPickups);",
    "syncCollectionPickupSelection(map, selectedCollectionPickupId, collectionVisible);",
    "syncApplicationFilters(",
  ]) {
    assert.ok(source.includes(syncCall), `missing live MapLibre sync call: ${syncCall}`);
  }
});

test("style.load still hydrates every primary application GeoJSON source from latest refs", () => {
  const styleLoad = source.slice(source.indexOf('map.once("style.load"'), source.indexOf('map.on("idle"'));
  assert.match(styleLoad, /const current = dataRef\.current;/);
  assert.match(styleLoad, /syncAreaData\(map, current\.areas\);/);
  assert.match(styleLoad, /syncStreetData\(map, current\.tasks\);/);
  assert.match(styleLoad, /syncHouseData\(map, current\.houses\);/);
});

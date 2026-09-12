import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mapView = readFileSync(new URL("../src/map/MapView.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("new application GeoJSON sources are seeded with current core data", () => {
  assert.match(mapView, /buildApplicationMapStyle\(initialData\?: InitialApplicationSourceData\)/u);
  assert.match(mapView, /data: areasToGeoJson\(initialData\?\.areas \?\? \[\]\)/u);
  assert.match(mapView, /data: streetsToGeoJson\(initialData\?\.tasks \?\? \[\]\)/u);
  assert.match(mapView, /data: housesToGeoJson\(initialData\?\.houses \?\? \[\]\)/u);
  assert.match(mapView, /const seeded = installApplicationMapStyle\(map, current\);/u);
  assert.match(mapView, /if \(!seeded\.areas\) syncAreaData\(map, current\.areas\);/u);
  assert.match(mapView, /if \(!seeded\.streets\) syncStreetData\(map, current\.tasks\);/u);
  assert.match(mapView, /if \(!seeded\.houses\) syncHouseData\(map, current\.houses\);/u);
});

test("source seeding records direct hydration diagnostics", () => {
  assert.match(mapView, /dataset\.appliedAreas = String\(initialData\?\.areas\.length \?\? 0\)/u);
  assert.match(mapView, /dataset\.appliedStreets = String\(initialData\?\.tasks\.length \?\? 0\)/u);
  assert.match(mapView, /dataset\.appliedHouses = String\(initialData\?\.houses\.length \?\? 0\)/u);
});

test("campaign runtime no longer installs a global GeoJSONSource prototype guard", () => {
  assert.doesNotMatch(main, /maplibreGeoJsonLifecycleCompat/u);
  assert.doesNotMatch(main, /installMapLibreGeoJsonLifecycleCompat/u);
});

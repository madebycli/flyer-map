import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compat = readFileSync(
  new URL("../src/map/maplibreGeoJsonLifecycleCompat.ts", import.meta.url),
  "utf8",
);
const diagnostics = readFileSync(
  new URL("../src/diagnostics/MapDiagnostics.tsx", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("MapLibre GeoJSON compatibility coalesces initial vf source hydration across a guaranteed frame boundary", () => {
  assert.match(compat, /this\.id\.startsWith\(APPLICATION_SOURCE_PREFIX\)/u);
  assert.match(compat, /const pendingHydrations = new WeakMap<GeoJSONSource, PendingHydration>\(\);/u);
  assert.match(compat, /pending\.data = data;/u);
  assert.match(compat, /map\.once\("render", finish\);/u);
  assert.match(compat, /view\.requestAnimationFrame\(\(\) => \{/u);
  assert.match(compat, /map\.triggerRepaint\(\);/u);
  assert.match(compat, /view\.requestAnimationFrame\(finish\);/u);
  assert.match(compat, /hydratedSources\.add\(this\);/u);
  assert.match(
    compat,
    /if \(!map \|\| !this\.id\.startsWith\(APPLICATION_SOURCE_PREFIX\) \|\| hydratedSources\.has\(this\)\)/u,
  );
  assert.match(compat, /maplibre\/maplibre-gl-js#7634/u);
});

test("map diagnostics distinguish queued and applied GeoJSON payloads from source queries", () => {
  for (const field of [
    "queuedAreas",
    "queuedStreets",
    "queuedHouses",
    "appliedAreas",
    "appliedStreets",
    "appliedHouses",
  ]) {
    assert.match(diagnostics, new RegExp(`dataset\\.${field}`));
  }
  assert.match(compat, /recordFeatureCount\(map, this\.id, "queued", data\)/u);
  assert.match(compat, /recordFeatureCount\(map, this\.id, "applied", latest\.data\)/u);
});

test("campaign runtime installs the GeoJSON lifecycle guard before loading PlatformShell", () => {
  const start = main.indexOf("const PlatformShell = lazy(async () =>");
  const end = main.indexOf("const ActionWorkbenchPreview", start);
  assert.ok(start >= 0 && end > start, "PlatformShell lazy loader block missing");
  const loader = main.slice(start, end);
  const installIndex = loader.indexOf("installMapLibreGeoJsonLifecycleCompat();");
  const platformImportIndex = loader.indexOf('import("./platform/PlatformShell")');
  assert.ok(installIndex >= 0, "GeoJSON lifecycle guard is not installed");
  assert.ok(platformImportIndex >= 0, "PlatformShell import is missing");
  assert.ok(installIndex < platformImportIndex, "guard must install before MapView can load");
});

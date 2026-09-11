import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compat = readFileSync(
  new URL("../src/map/maplibreGeoJsonLifecycleCompat.ts", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("MapLibre GeoJSON compatibility waits for a render only while the style is dirty", () => {
  assert.match(compat, /if \(!map \|\| map\.isStyleLoaded\(\)\) return originalSetData\.call\(this, data\);/u);
  assert.match(compat, /map\.once\("render", apply\);/u);
  assert.match(compat, /map\.triggerRepaint\(\);/u);
  assert.match(compat, /maplibre\/maplibre-gl-js#7634/u);
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

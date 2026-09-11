import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("../src/ui-dark-mode.css", import.meta.url), "utf8");

test("UI appearance initializes before the app renders", () => {
  assert.match(mainSource, /import \{ initializeAppearance \} from "\.\/settings\/appearance\.ts";/);
  assert.match(mainSource, /installRxdbFetchGuard\(\);\s*initializeAppearance\(\);/);
  assert.match(mainSource, /import "\.\/ui-dark-mode\.css";/);
});

test("platform menu exposes system, light and dark UI appearance", () => {
  assert.match(shellSource, /<AppearanceControl/);
  assert.match(shellSource, /system: "System"/);
  assert.match(shellSource, /light: "Hell"/);
  assert.match(shellSource, /dark: "Dunkel"/);
  assert.match(shellSource, /saveAppearancePreference\(preference\)/);
  assert.match(shellSource, /applyAppearancePreference\(preference\)/);
});

test("dark theme is scoped to UI and explicitly excludes MapLibre form descendants", () => {
  assert.match(themeSource, /html\[data-appearance="dark"\]/);
  assert.match(themeSource, /:not\(\.maplibregl-map \*\)/);
  assert.doesNotMatch(themeSource, /filter:\s*(?:invert|brightness)/i);
  assert.doesNotMatch(themeSource, /\.maplibregl-(?:canvas|ctrl|popup)\s*\{/i);
});

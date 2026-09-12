import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/settings/SettingsSheet.tsx", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("../src/ui-dark-mode.css", import.meta.url), "utf8");
const moduleThemeSource = readFileSync(new URL("../src/ui-dark-mode-modules.css", import.meta.url), "utf8");

test("UI appearance initializes before the app renders", () => {
  assert.match(mainSource, /import \{ initializeAppearance \} from "\.\/settings\/appearance\.ts";/);
  assert.match(mainSource, /installRxdbFetchGuard\(\);\s*initializeAppearance\(\);/);
  assert.match(mainSource, /import "\.\/ui-dark-mode\.css";/);
});

test("settings exposes system, light and dark UI appearance", () => {
  assert.doesNotMatch(shellSource, /<AppearanceControl/u);
  assert.match(settingsSource, /<AppearanceControl/u);
  assert.match(settingsSource, /className="settings-appearance-panel"/u);
  assert.match(settingsSource, /system: "System"/u);
  assert.match(settingsSource, /light: "Hell"/u);
  assert.match(settingsSource, /dark: "Dunkel"/u);
  assert.match(appSource, /saveAppearancePreference\(preference\)/u);
  assert.match(appSource, /applyAppearancePreference\(preference\)/u);
});

test("dark theme is scoped to UI and explicitly excludes MapLibre form descendants", () => {
  assert.match(themeSource, /html\[data-appearance="dark"\]/);
  assert.ok(themeSource.includes("--ui-bg: #0f0f0f;"));
  assert.ok(themeSource.includes("--ui-surface: #181818;"));
  assert.ok(themeSource.includes("--ui-surface-raised: #212121;"));
  assert.ok(themeSource.includes("--ui-surface-soft: #272727;"));
  assert.ok(themeSource.includes("--ui-muted: #aaaaaa;"));
  assert.ok(themeSource.includes("--ui-accent: #3f3f3f;"));
  assert.ok(!themeSource.includes("--ui-bg: #101612;"));
  assert.ok(!themeSource.includes("--ui-surface: #18211b;"));
  assert.ok(moduleThemeSource.includes("rgb(33 33 33 / 88%)"));
  assert.ok(themeSource.includes("color-scheme: dark;"));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .button.secondary'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .bottom-sheet.field-sheet-enhanced .sheet-header'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .field-hub-card'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .area-preparation-progress'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .comments-panel'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .settings-section h3'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .geometry-status.is-valid'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .org-admin-page .org-lifecycle-actions button'));
  assert.ok(themeSource.includes('html[data-appearance="dark"] .org-admin-page .org-detail-grid div'));
  assert.match(themeSource, /:not\(\.maplibregl-map \*\)/);
  assert.doesNotMatch(themeSource, /filter:\s*(?:invert|brightness)/i);
  assert.doesNotMatch(themeSource, /\.maplibregl-(?:canvas|ctrl|popup)\s*\{/i);
});

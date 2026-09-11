import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const themeSource = readFileSync(new URL("../src/theme/uiTheme.ts", import.meta.url), "utf8");
const bridgeSource = readFileSync(new URL("../src/theme/ThemeSettingsBridge.tsx", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../src/ui-theme.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("dark is the first-run UI default and system mode follows device preference", () => {
  assert.match(themeSource, /return "dark";/u);
  assert.match(themeSource, /preference === "system"/u);
  assert.match(themeSource, /prefers-color-scheme: dark/u);
  assert.match(themeSource, /addEventListener\("change"/u);
  assert.match(themeSource, /localStorage\.setItem\(STORAGE_KEY, preference\)/u);
});

test("appearance setting exposes dark light and device modes inside settings", () => {
  assert.match(bridgeSource, /data-ui-theme-settings="true"/u);
  assert.match(bridgeSource, /<option value="dark">Dunkel<\/option>/u);
  assert.match(bridgeSource, /<option value="light">Hell<\/option>/u);
  assert.match(bridgeSource, /<option value="system">Geräteeinstellung<\/option>/u);
  assert.match(bridgeSource, /\.settings-field-hub-content/u);
  assert.match(mainSource, /<ThemeSettingsBridge \/>/u);
});

test("dark UI theme does not darken the MapLibre map", () => {
  assert.match(themeCss, /Keep the actual map intentionally bright/u);
  assert.match(themeCss, /\.maplibregl-canvas[\s\S]*filter: none !important;/u);
  assert.doesNotMatch(themeCss, /\.maplibregl-canvas[^}]*filter:\s*(?:invert|brightness|grayscale)/u);
  assert.match(mainSource, /import "\.\/ui-theme\.css";/u);
});

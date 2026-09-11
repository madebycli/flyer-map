import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const fieldSheet = readFileSync(new URL("../src/platform/FieldBottomSheet.tsx", import.meta.url), "utf8");
const fieldHub = readFileSync(new URL("../src/platform/FieldHub.tsx", import.meta.url), "utf8");
const sheetCss = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");
const platformCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");
const mapCss = readFileSync(new URL("../src/map-context-ui.css", import.meta.url), "utf8");

test("all FieldHubs use the shared PC bottom-left edge gap and stay sharp over the map", () => {
  assert.match(sheetCss, /justify-content:\s*flex-start;/u);
  assert.doesNotMatch(sheetCss, /field-sheet-overlay\s*\{\s*align-items:\s*center/u);
  assert.match(sheetCss, /backdrop-filter:\s*none;/u);
  assert.match(sheetCss, /-webkit-backdrop-filter:\s*none;/u);
  assert.match(platformCss, /--platform-field-edge-gap:\s*0\.55rem;/u);
  assert.match(platformCss, /--platform-field-edge-gap:\s*0\.75rem;/u);
  assert.doesNotMatch(platformCss, /backdrop-filter:\s*blur/u);
  for (const path of ["src/m4.css", "src/m5.css", "src/styles.css", "src/platform/session-map-highlight.css"]) {
    const css = readFileSync(new URL("../" + path, import.meta.url), "utf8");
    assert.doesNotMatch(css, /backdrop-filter:\s*blur/u, path);
  }
});

test("interactive map modes pass pointer input through the narrow HUD", () => {
  assert.match(
    app,
    /title="Gebiet auswählen"[\s\S]*?overlayClassName="map-context-overlay map-interaction-overlay map-area-selection-overlay"[\s\S]*?map-area-selection-hub/u,
  );
  assert.match(
    app,
    /mode === "edit"[\s\S]*?overlayClassName="map-context-overlay map-interaction-overlay"/u,
  );
  assert.match(mapCss, /\.field-sheet-overlay\.map-interaction-overlay\s*\{\s*pointer-events:\s*none;/u);
  assert.match(mapCss, /\.field-sheet-overlay\.map-interaction-overlay\s*>\s*\.field-bottom-sheet\s*\{\s*pointer-events:\s*auto;/u);
  assert.match(mapCss, /\.map-area-selection-hub\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*0;/u);
});

test("area renaming is local until one explicit save", () => {
  assert.match(app, /\| "area-name"/u);
  assert.match(app, /const \[areaNameDraft, setAreaNameDraft\] = useState\("");/u);
  assert.match(app, /onTitleClick=\{canEditSelectedArea \? openAreaNameEditor : undefined\}/u);
  assert.match(app, /const saveAreaName = \(\) => \{[\s\S]*?commitSnapshot/u);
  assert.match(app, /sheet === "area-name"[\s\S]*?setAreaNameDraft\(event\.target\.value\)/u);
  assert.doesNotMatch(app, /updateSelectedArea\(\{ name: event\.target\.value \}\)/u);
  assert.doesNotMatch(app, /<input value=\{selectedArea\.name\}[\s\S]*?onChange/u);
  assert.match(fieldHub, /overlayClassName\?: string;/u);
  assert.match(fieldSheet, /onTitleClick\?: \(\) => void;/u);
});

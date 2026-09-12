import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/map-context-ui.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const collection = readFileSync(new URL("../src/collection/CollectionAdminPanel.tsx", import.meta.url), "utf8");

test("map-critical field surfaces never blur the map", () => {
  assert.match(main, /import "\.\/map-context-ui\.css";/u);
  assert.match(
    css,
    /\.map-toolbar,\s*\.mode-sheet,\s*\.bottom-sheet\.compact-sheet,\s*\.bottom-sheet\.task-sheet\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/u,
  );
});

test("every current map-dependent workflow is covered by the universal FieldHub surface", () => {
  assert.match(app, /manualStreetAreaSelection \? \([\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /mode === "draw" \? \([\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /mode === "street-draw" \? \([\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /mode === "edit" \? \([\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /mode === "collection-main-draw" \|\| mode === "collection-area-draw"[\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /mode === "collection-area-edit" \? \([\s\S]*?<FieldHub[\s\S]*?map-context-hub map-mode-hub/u);
  assert.match(app, /sheet === "area"[\s\S]*?<FieldHub[\s\S]*?map-area-hub/u);
  assert.match(app, /sheet === "task"[\s\S]*?<FieldHub[\s\S]*?map-task-hub/u);
  assert.match(app, /sheet === "house"[\s\S]*?<FieldHub[\s\S]*?map-house-hub/u);
  assert.match(collection, /<FieldHub[\s\S]*?collection-admin-sheet/u);
  assert.doesNotMatch(app, /className="mode-sheet"/u);
  assert.doesNotMatch(app, /bottom-sheet/u);
  assert.doesNotMatch(collection, /className="bottom-sheet/u);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/map-context-ui.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

test("map-critical field surfaces never blur the map", () => {
  assert.match(main, /import "\.\/map-context-ui\.css";/u);
  assert.match(
    css,
    /\.map-toolbar,\s*\.mode-sheet,\s*\.bottom-sheet\.compact-sheet,\s*\.bottom-sheet\.task-sheet\s*\{[\s\S]*?backdrop-filter:\s*none;[\s\S]*?-webkit-backdrop-filter:\s*none;/u,
  );
});

test("every current map-dependent workflow is covered by a clear map surface", () => {
  assert.match(app, /manualStreetAreaSelection \? \([\s\S]*?className="mode-sheet"/u);
  assert.match(app, /mode === "draw" \? \([\s\S]*?className="mode-sheet"/u);
  assert.match(app, /mode === "street-draw" \? \([\s\S]*?className="mode-sheet"/u);
  assert.match(app, /mode === "edit" \? \([\s\S]*?className="mode-sheet"/u);
  assert.match(app, /mode === "collection-main-draw" \|\| mode === "collection-area-draw"[\s\S]*?className="mode-sheet collection-mode-sheet"/u);
  assert.match(app, /mode === "collection-area-edit" \? \([\s\S]*?className="mode-sheet collection-mode-sheet"/u);
  assert.match(app, /sheet === "area"[\s\S]*?bottom-sheet compact-sheet/u);
  assert.match(app, /sheet === "task"[\s\S]*?bottom-sheet task-sheet/u);
  assert.match(app, /sheet === "house"[\s\S]*?bottom-sheet task-sheet commentable-task-sheet/u);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Area and Street detail sheets reuse the proven Field HUD header geometry", async () => {
  const css = await readFile("src/map-context-ui.css", "utf8");

  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced\.compact-sheet,[\s\S]*?\.bottom-sheet\.field-sheet-enhanced\.task-sheet:not\(\.commentable-task-sheet\)/u);
  assert.match(css, /--field-hud-sheet-padding-inline: 0\.9rem;/u);
  assert.match(css, /--field-hud-handle-min-height: 1\.4rem;/u);
  assert.match(css, /--field-hud-handle-padding-top: 0\.35rem;/u);
  assert.match(css, /--field-hud-handle-padding-bottom: 0\.2rem;/u);
  assert.match(css, /--field-hud-header-padding-top: 0\.35rem;/u);
  assert.match(css, /--field-hud-header-padding-bottom: 0\.72rem;/u);
  assert.match(css, /--field-hud-close-size: 2\.75rem;/u);
  assert.match(css, /margin-bottom: 0\.85rem;/u);
  assert.match(css, /task-sheet:not\(\.commentable-task-sheet\)/u);
});

test("Area and Street map context remains blur-free", async () => {
  const css = await readFile("src/map-context-ui.css", "utf8");

  assert.match(css, /\.bottom-sheet\.compact-sheet,[\s\S]*?\.bottom-sheet\.task-sheet[\s\S]*?backdrop-filter: none;/u);
  assert.match(css, /-webkit-backdrop-filter: none;/u);
});

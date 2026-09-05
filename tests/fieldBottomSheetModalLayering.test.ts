import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");

test("nested room modal layers above the field bottom sheet", () => {
  assert.match(css, /\.field-sheet-overlay\s*\{[\s\S]*?z-index:\s*3400;/u);
  assert.match(
    css,
    /\.field-sheet-overlay\s*~\s*\.team-center-modal-backdrop\s*\{[\s\S]*?z-index:\s*3500;/u,
  );
});

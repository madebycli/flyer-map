import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("mission sheets use a real accessible collapse control and keep headers visible", async () => {
  const [app, settings, css] = await Promise.all([
    readFile("src/App.tsx", "utf8"), readFile("src/settings/SettingsSheet.tsx", "utf8"), readFile("src/styles.css", "utf8"),
  ]);
  assert.match(app, /const sheetToggleLabel = sheetCollapsed \? "Fenster ausklappen" : "Fenster einklappen"/u);
  assert.match(app, /sheet-handle-button[\s\S]*aria-label=\{sheetToggleLabel\}/u);
  assert.match(settings, /sheet-handle-button[\s\S]*Fenster einklappen/u);
  assert.match(app, /useEffect\(\(\) => \{\s*setSheetCollapsed\(false\);\s*\}, \[sheet\]\)/u);
  assert.match(css, /\.bottom-sheet\.is-collapsed > :not\(\.sheet-handle-button\):not\(\.sheet-header\)/u);
  assert.match(css, /bottom: calc\(env\(safe-area-inset-bottom\) \+ 4\.45rem\)/u);
});

test("Team deletion remains an Admin-only destructive action with a local Area guard", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /if \(!isAdmin\) return;[\s\S]*Team kann nicht gelöscht werden/u);
  assert.match(app, /Team „\$\{team\.name/u);
  assert.match(app, /disabled=\{snapshot\.areas\.some\(\(area\) => area\.teamId === team\.id\)\}/u);
});

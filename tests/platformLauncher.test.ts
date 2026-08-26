import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");

test("field chrome uses a 3x3 launcher glyph and compact Team context", () => {
  assert.match(shellSource, /Array\.from\(\{ length: 9 \}/);
  assert.match(shellSource, /className="platform-active-team"/);
  assert.match(shellCss, /\.platform-grid-glyph\s*\{[\s\S]*grid-template-columns: repeat\(3,/);
  assert.match(shellCss, /\.platform-map-layer \.map-toolbar\s*\{[\s\S]*display: none;/);
});

test("launcher is a sheet with home-screen icon labels", () => {
  assert.match(shellSource, /className="platform-menu-sheet"/);
  assert.match(shellSource, /menuLabel: "Stats"/);
  assert.match(shellSource, /menuLabel: "Team"/);
  assert.match(shellSource, /menuLabel: "Feedback"/);
  assert.match(shellCss, /\.platform-menu-overlay\s*\{[\s\S]*align-items: flex-end;/);
  assert.match(shellCss, /\.platform-menu-grid\s*\{[\s\S]*grid-template-columns: repeat\(4,/);
  assert.doesNotMatch(shellSource, /Was möchtest du öffnen\?/);
});

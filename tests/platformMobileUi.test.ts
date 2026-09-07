import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("organizer navigation and lifecycle controls stay usable on mobile", async () => {
  const css = await readFile("src/organization/organization-admin.css", "utf8");
  assert.match(css, /\.org-admin-topbar nav\s*\{[\s\S]*?flex-wrap: nowrap[\s\S]*?overflow-x: auto/u);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.org-admin-topbar nav button[\s\S]*?min-height: 44px/u);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.org-lifecycle-actions\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(css, /\.org-lifecycle-actions button[\s\S]*?min-height: 48px/u);
});

test("launcher opens expanded while the focused team summary stays compact", async () => {
  const [shell, team] = await Promise.all([
    readFile("src/platform/PlatformShell.tsx", "utf8"),
    readFile("src/team/TeamHub.tsx", "utf8"),
  ]);
  assert.match(shell, /title="Menü"[\s\S]*?initialSnap="expanded"/u);
  assert.doesNotMatch(shell, /className="platform-menu-sheet"/u);
  assert.match(team, /kicker="Team"[\s\S]*?initialSnap="compact"/u);
});

test("short mobile launcher viewports keep the final Settings row discoverable", async () => {
  const css = await readFile("src/platform/platform-shell.css", "utf8");
  assert.match(css, /@media \(max-height: 720px\)[\s\S]*?\.platform-menu-grid\s*\{[\s\S]*?gap: 0\.55rem[\s\S]*?padding-block: 0\.1rem 0\.25rem/u);
  assert.match(css, /@media \(max-height: 720px\)[\s\S]*?\.platform-app-item\s*\{[\s\S]*?min-height: 4\.45rem/u);
  assert.match(css, /@media \(max-height: 720px\)[\s\S]*?\.platform-app-icon\s*\{[\s\S]*?width: 3\.2rem[\s\S]*?height: 3\.2rem/u);
});

test("all field HUD headers share one geometry contract", async () => {
  const css = await readFile("src/platform/field-bottom-sheet.css", "utf8");
  assert.match(css, /\.field-bottom-sheet,\s*\.bottom-sheet\.field-sheet-enhanced\s*\{[\s\S]*?--field-hud-sheet-padding-inline: 0\.9rem[\s\S]*?--field-hud-sheet-padding-inline-negative: -0\.9rem[\s\S]*?--field-hud-handle-min-height: 1\.4rem[\s\S]*?--field-hud-header-padding-inline: 0\.9rem[\s\S]*?--field-hud-close-size: 2\.75rem/u);
  assert.match(css, /\.field-sheet-handle-button\s*\{[\s\S]*?min-height: var\(--field-hud-handle-min-height\)[\s\S]*?padding: var\(--field-hud-handle-padding-top\) 0 var\(--field-hud-handle-padding-bottom\)/u);
  assert.match(css, /\.field-sheet-header\s*\{[\s\S]*?min-height: calc\(var\(--field-hud-close-size\)[\s\S]*?padding: var\(--field-hud-header-padding-top\) var\(--field-hud-header-padding-inline\) var\(--field-hud-header-padding-bottom\)[\s\S]*?border-bottom: var\(--field-hud-header-divider\)/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced\.compact-sheet,\s*\.bottom-sheet\.field-sheet-enhanced\.task-sheet\s*\{[\s\S]*?--field-hud-sheet-padding-inline: 0\.45rem[\s\S]*?--field-hud-sheet-padding-inline-negative: -0\.45rem/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-handle-button\s*\{[\s\S]*?width: calc\(100% \+ var\(--field-hud-sheet-padding-inline\) \+ var\(--field-hud-sheet-padding-inline\)\)[\s\S]*?margin: -0\.45rem var\(--field-hud-sheet-padding-inline-negative\) 0/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-header\s*\{[\s\S]*?top: var\(--field-hud-handle-min-height\)[\s\S]*?margin: 0 var\(--field-hud-sheet-padding-inline-negative\) 0\.85rem[\s\S]*?border-bottom: var\(--field-hud-header-divider\)/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-header \.icon-button\s*\{[\s\S]*?width: var\(--field-hud-close-size\)[\s\S]*?height: var\(--field-hud-close-size\)/u);
});

test("compact Area chrome trims whitespace without shrinking the 44px close target", async () => {
  const css = await readFile("src/platform/field-bottom-sheet.css", "utf8");
  assert.match(css, /--field-hud-close-size: 2\.75rem/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced\.compact-sheet\s*\{[\s\S]*?--field-hud-handle-min-height: 1\.05rem[\s\S]*?--field-hud-header-padding-top: 0\.12rem[\s\S]*?--field-hud-header-padding-bottom: 0\.25rem/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced\.compact-sheet \.sheet-header\s*\{[\s\S]*?margin-bottom: 0\.5rem/u);
});

test("sheet dragging updates the DOM without a React render per pointer move", async () => {
  const source = await readFile("src/platform/FieldBottomSheet.tsx", "utf8");
  assert.doesNotMatch(source, /dragHeight|setDragHeight/u);
  assert.match(source, /field-sheet-dragging/u);
  assert.match(source, /style\.setProperty\("--field-sheet-height"/u);
});

test("legacy sheet enhancement cannot feed back through its own class mutation", async () => {
  const source = await readFile("src/platform/FieldBottomSheet.tsx", "utf8");
  assert.match(source, /if \(!sheet\.classList\.contains\("field-sheet-enhanced"\)\) \{[\s\S]*?sheet\.classList\.add\("field-sheet-enhanced"\)/u);
  assert.match(source, /observer\.observe\(document\.body, \{ childList: true, subtree: true \}\)/u);
  assert.doesNotMatch(source, /attributes: true|attributeFilter: \["class"\]/u);
});

test("legacy sheet chrome stays opaque and contiguous while content scrolls", async () => {
  const css = await readFile("src/platform/field-bottom-sheet.css", "utf8");
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced\s*\{[\s\S]*?overflow-x: hidden[\s\S]*?overflow-y: auto[\s\S]*?scroll-padding-top: 5\.4rem/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-handle-button\s*\{[\s\S]*?top: 0[\s\S]*?min-height: var\(--field-hud-handle-min-height\)[\s\S]*?background: #fff/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-handle\s*\{[\s\S]*?margin: 0 auto/u);
  assert.match(css, /\.bottom-sheet\.field-sheet-enhanced \.sheet-header\s*\{[\s\S]*?top: var\(--field-hud-handle-min-height\)[\s\S]*?padding: var\(--field-hud-header-padding-top\) var\(--field-hud-header-padding-inline\) var\(--field-hud-header-padding-bottom\)[\s\S]*?background: #fff/u);
});

test("platform settings and team commands open legacy sheets even after a mode transition", async () => {
  const [source, shell] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/platform/PlatformShell.tsx", "utf8"),
  ]);
  assert.match(shell, /closeOverlays\(\);[\s\S]*?window\.setTimeout\(\(\) => \{[\s\S]*?setAppCommand\(\{ id: nextCommandId, type \}\)/u);
  assert.match(source, /const openLegacySheet = \(nextSheet: "settings" \| "teams" \| "campaign-comments"\)/u);
  assert.match(source, /platformCommand\.type === "open-settings"[\s\S]*?openLegacySheet\("settings"\)/u);
  assert.match(source, /platformCommand\.type === "open-team-management"[\s\S]*?openLegacySheet\("teams"\)/u);
  assert.match(source, /setSheetCollapsed\(false\)/u);
  assert.match(source, /if \(mode !== "browse"\) return;/u);
});

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

test("launcher and team hub open at an expanded mobile snap", async () => {
  const [shell, team] = await Promise.all([
    readFile("src/platform/PlatformShell.tsx", "utf8"),
    readFile("src/team/TeamHub.tsx", "utf8"),
  ]);
  assert.match(shell, /title="Menü"[\s\S]*?initialSnap="expanded"[\s\S]*?platform-menu-sheet/u);
  assert.match(team, /kicker="Team"[\s\S]*?initialSnap="expanded"/u);
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

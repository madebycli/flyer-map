import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlatformLauncherItems, type PlatformAppContext } from "../src/platform/platformContract.ts";

const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");

function context(overrides: Partial<PlatformAppContext> = {}): PlatformAppContext {
  return {
    accessRole: "viewer",
    activeTeam: { id: "team_one", name: "Team Nord", color: "#2563eb" },
    launcherAvailable: true,
    canManageTeams: false,
    canCreateArea: false,
    ...overrides,
  };
}

test("field chrome uses a bottom 3x3 launcher bar with the App active Team", () => {
  assert.match(shellSource, /Array\.from\(\{ length: 9 \}/);
  assert.match(shellSource, /appContext\?\.activeTeam\?\.name/);
  assert.match(shellSource, /<strong>\{teamName\}<\/strong>/);
  assert.match(appSource, /onPlatformContextChange\?\.\(\{/);
  assert.match(appSource, /name: activeTeam\.name/);
  assert.match(shellCss, /\.platform-grid-glyph\s*\{[\s\S]*grid-template-columns: repeat\(3,/);
  assert.match(shellCss, /\.platform-field-bar\s*\{[\s\S]*bottom: calc\(env\(safe-area-inset-bottom\) \+ 0\.55rem\);/);
  assert.match(shellCss, /\.platform-map-layer \.map-toolbar\s*\{[\s\S]*display: none;/);
});

test("PlatformShell uses the typed App bridge instead of Workbench or DOM proxies", () => {
  assert.match(shellSource, /platformCommand=\{appCommand\}/);
  assert.match(shellSource, /onPlatformContextChange=\{setAppContext\}/);
  assert.match(appSource, /platformCommand\.type === "open-settings"/);
  assert.match(appSource, /platformCommand\.type === "open-team-management"/);
  assert.match(appSource, /platformCommand\.type === "start-area-drawing"/);
  assert.doesNotMatch(shellSource, /LiveGroupWorkbenchPreview/);
  assert.doesNotMatch(shellSource, /querySelector|click\(\)/);
});

test("launcher registry hides editing and unfinished destinations from viewers", () => {
  assert.deepEqual(
    buildPlatformLauncherItems(context()).map((item) => item.id),
    ["map", "settings"],
  );
  assert.doesNotMatch(shellSource, /Foundation|Security-Gate|menuLabel: "Stats"|menuLabel: "Feedback"/);
});

test("launcher registry exposes only current-role real actions", () => {
  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "team-editor", canCreateArea: true }),
    ).map((item) => item.id),
    ["map", "settings", "area-create"],
  );

  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "admin", canManageTeams: true, canCreateArea: true }),
    ).map((item) => item.id),
    ["map", "settings", "team", "area-create"],
  );
});

test("launcher remains a compact rounded sheet rather than a fullscreen dashboard", () => {
  assert.match(shellSource, /className="platform-menu-sheet"/);
  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "admin", canManageTeams: true, canCreateArea: true }),
    ).map((item) => item.label),
    ["Karte", "Einstellungen", "Team", "Gebiet"],
  );
  assert.match(shellCss, /\.platform-menu-overlay\s*\{[\s\S]*align-items: flex-end;/);
  assert.match(shellCss, /\.platform-menu-grid\s*\{[\s\S]*grid-template-columns: repeat\(4,/);
  assert.doesNotMatch(shellSource, /Was möchtest du öffnen\?/);
});

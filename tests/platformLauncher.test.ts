import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlatformLauncherItems, type PlatformAppContext } from "../src/platform/platformContract.ts";

const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");

function context(overrides: Partial<PlatformAppContext> = {}): PlatformAppContext {
  return {
    campaignId: "campaign_one",
    accessRole: "viewer",
    accessTeamId: null,
    activeGroupId: null,
    activeTeam: { id: "team_one", name: "Team Nord", color: "#2563eb" },
    teams: [{ id: "team_one", name: "Team Nord", color: "#2563eb" }],
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

test("PlatformShell uses typed real Team and Field Session surfaces instead of Workbench or DOM proxies", () => {
  assert.match(shellSource, /platformCommand=\{appCommand\}/);
  assert.match(shellSource, /onPlatformContextChange=\{setAppContext\}/);
  assert.match(shellSource, /<TeamHub/);
  assert.match(shellSource, /<FieldSessionsHub/);
  assert.match(shellSource, /type: "select-active-team"/);
  assert.match(appSource, /platformCommand\.type === "open-settings"/);
  assert.match(appSource, /platformCommand\.type === "open-team-management"/);
  assert.match(appSource, /platformCommand\.type === "start-area-drawing"/);
  assert.match(appSource, /platformCommand\.type === "select-active-team"/);
  assert.doesNotMatch(shellSource, /LiveGroupWorkbenchPreview|FieldSessionWorkbenchPreview/);
  assert.doesNotMatch(shellSource, /querySelector|click\(\)/);
});

test("launcher gives authenticated viewers Team Hub and real Einsätze but hides editing destinations", () => {
  assert.deepEqual(
    buildPlatformLauncherItems(context()).map((item) => item.id),
    ["map", "team", "sessions", "activity", "comments", "settings"],
  );
  assert.equal(buildPlatformLauncherItems(context()).find((item) => item.id === "team")?.opensTeamHub, true);
  assert.equal(
    buildPlatformLauncherItems(context()).find((item) => item.id === "sessions")?.opensFieldSessions,
    true,
  );
  assert.doesNotMatch(shellSource, /Foundation|Security-Gate|menuLabel: "Stats"|menuLabel: "Feedback"/);
});

test("Einsätze is hidden without access while Team Hub remains available for joining", () => {
  assert.deepEqual(
    buildPlatformLauncherItems(context({ accessRole: null })).map((item) => item.id),
    ["map", "team", "settings"],
  );
});

test("launcher registry exposes history to scoped roles and editing only when capability allows", () => {
  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "team-editor", accessTeamId: "team_one", canCreateArea: true }),
    ).map((item) => item.id),
    ["map", "team", "sessions", "activity", "comments", "settings", "area-create"],
  );

  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "admin", canManageTeams: true, canCreateArea: true }),
    ).map((item) => item.id),
    ["map", "team", "sessions", "activity", "comments", "settings", "area-create"],
  );

  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "field-group-member", accessTeamId: "team_one" }),
    ).map((item) => item.id),
    ["map", "team", "sessions", "activity", "comments", "settings"],
  );
});

test("launcher remains a compact rounded sheet rather than a fullscreen dashboard", () => {
  assert.match(shellSource, /className="platform-menu-sheet"/);
  assert.deepEqual(
    buildPlatformLauncherItems(
      context({ accessRole: "admin", canManageTeams: true, canCreateArea: true }),
    ).map((item) => item.label),
    ["Karte", "Team", "Einsätze", "Aktivität", "Kommentare", "Einstellungen", "Gebiet"],
  );
  assert.match(shellCss, /\.platform-menu-overlay\s*\{[\s\S]*align-items: flex-end;/);
  assert.match(shellCss, /\.platform-menu-grid\s*\{[\s\S]*grid-template-columns: repeat\(4,/);
  assert.doesNotMatch(shellSource, /Was möchtest du öffnen\?/);
});

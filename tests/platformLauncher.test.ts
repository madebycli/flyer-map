
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPlatformLauncherItems, type PlatformAppContext } from "../src/platform/platformContract.ts";

const shellSource = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const teamHubSource = readFileSync(new URL("../src/team/TeamHub.tsx", import.meta.url), "utf8");
const roomHubSource = readFileSync(new URL("../src/team/RoomsHub.tsx", import.meta.url), "utf8");
const commentsHubSource = readFileSync(new URL("../src/collaboration/CommentsHub.tsx", import.meta.url), "utf8");
const streetsHubSource = readFileSync(new URL("../src/streets/StreetsHub.tsx", import.meta.url), "utf8");
const sheetSource = readFileSync(new URL("../src/platform/FieldBottomSheet.tsx", import.meta.url), "utf8");
const sheetCss = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");

function context(overrides: Partial<PlatformAppContext> = {}): PlatformAppContext {
  return {
    campaignId: "campaign_one",
    accessRole: "viewer",
    accessTeamId: null,
    activeGroupId: null,
    activeTeam: null,
    teams: [{ id: "team_one", name: "Team Nord", color: "#2563eb" }],
    streets: [],
    launcherAvailable: true,
    canManageTeams: false,
    canCreateArea: false,
    canCreateManualStreet: false,
    syncState: "healthy",
    syncLabel: null,
    ...overrides,
  };
}

test("field launcher is the single flat primary navigation", () => {
  const items = buildPlatformLauncherItems(context({ accessRole: "admin", canManageTeams: true, canCreateArea: true }));
  assert.deepEqual(items.map((item) => item.id), ["team", "rooms", "stats", "comments", "streets", "area-create", "settings"]);
  assert.deepEqual(items.map((item) => item.label), ["Team", "Rooms", "Fortschritt", "Kommentare", "Streets", "Gebiet", "Einstellungen"]);
  assert.match(shellSource, /className="platform-grid-button"/u);
  assert.match(shellSource, /className="platform-menu-grid"/u);
  assert.match(shellSource, /<RoomsHub/u);
  assert.match(shellSource, /<TeamProgressHub/u);
  assert.match(shellSource, /<CommentsHub/u);
  assert.match(shellSource, /<StreetsHub/u);
  assert.doesNotMatch(teamHubSource, /team-center-tabs|Rooms|Fortschritt|Kommentare/u);
});

test("unauthenticated launcher keeps only safe entry surfaces", () => {
  assert.deepEqual(buildPlatformLauncherItems(context({ accessRole: null })).map((item) => item.id), ["team", "settings"]);
});

test("focused hubs reuse real field capabilities instead of fake apps", () => {
  assert.match(roomHubSource, /Room beitreten/u);
  assert.match(roomHubSource, /Join-Zugang anzeigen/u);
  assert.match(roomHubSource, /Join-Zugang erneuern/u);
  assert.match(roomHubSource, /Bereits beigetretene Mitglieder bleiben aktiv/u);
  assert.match(commentsHubSource, /TeamCommentsSummary/u);
  assert.match(streetsHubSource, /Straße manuell hinzufügen/u);
  assert.match(streetsHubSource, /keine zweite Karten-Engine/u);
});

test("shared field sheet has pointer capture, semantic snaps and independent body scrolling", () => {
  assert.match(sheetSource, /"compact" \| "expanded" \| "full"/u);
  assert.match(sheetSource, /visualViewport/u);
  assert.match(sheetSource, /onPointerDown/u);
  assert.match(sheetSource, /onPointerMove/u);
  assert.match(sheetSource, /onPointerUp/u);
  assert.match(sheetSource, /onPointerCancel/u);
  assert.match(sheetSource, /setPointerCapture/u);
  assert.match(sheetSource, /ArrowUp/u);
  assert.match(sheetCss, /\.field-sheet-body[\s\S]*overflow: auto/u);
  assert.match(sheetCss, /\.field-sheet-handle-button[\s\S]*touch-action: none/u);
});

test("street detail closes and deletes to map without implicit area navigation", () => {
  assert.match(appSource, /if \(sheet === "task"\) setSheet\(null\)/u);
  assert.ok(appSource.includes("setSelectedTaskId(null);\n    setSheet(null);\n  };\n\n  const commandCamera"));
  assert.match(appSource, /setSelectedTaskId\(null\); setSheet\(null\);/u);
});

test("healthy sync is a compact field-bar indicator and map refresh remains separate", () => {
  assert.match(shellSource, /platform-sync-indicator/u);
  assert.match(shellSource, /syncState !== "healthy" && syncLabel/u);
  assert.match(appSource, /syncState: platformSyncState/u);
  assert.match(shellCss, /\.platform-sync-indicator/u);
});

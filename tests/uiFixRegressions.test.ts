import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const teamHub = readFileSync(new URL("../src/team/TeamHub.tsx", import.meta.url), "utf8");
const progressHub = readFileSync(new URL("../src/team/TeamProgressHub.tsx", import.meta.url), "utf8");
const progressPanel = readFileSync(new URL("../src/team/TeamProgressPanel.tsx", import.meta.url), "utf8");
const roomsHub = readFileSync(new URL("../src/team/RoomsHub.tsx", import.meta.url), "utf8");
const joinAccessCss = readFileSync(new URL("../src/team/join-access.css", import.meta.url), "utf8");
const fieldSheet = readFileSync(new URL("../src/platform/FieldBottomSheet.tsx", import.meta.url), "utf8");
const fieldSheetCss = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const settingsSheet = readFileSync(new URL("../src/settings/SettingsSheet.tsx", import.meta.url), "utf8");
const syncStatus = readFileSync(new URL("../src/sync/SyncStatus.tsx", import.meta.url), "utf8");
const syncCss = readFileSync(new URL("../src/m5.css", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");

 test("short Team surfaces start compact instead of reserving an empty expanded sheet", () => {
  assert.match(teamHub, /initialSnap="compact"/u);
  assert.match(progressHub, /initialSnap="compact"/u);
});

test("Team progress uses the active Team Center layout classes", () => {
  assert.match(progressPanel, /className="team-center-section-heading"/u);
  assert.match(progressPanel, /className="team-center-info-grid"/u);
  assert.doesNotMatch(progressPanel, /team-hub-meta-row|team-hub-info-grid/u);
});

test("legacy sheets preserve natural content height until the user actually drags", () => {
  assert.doesNotMatch(fieldSheet, /sheet\.style\.getPropertyValue\("--field-sheet-height"\)[\s\S]*?snapHeight\("expanded"/u);
  assert.match(fieldSheet, /sheet\.scrollTop = 0/u);
  assert.match(fieldSheet, /savedSnap && SNAP_ORDER\.includes\(savedSnap\)/u);
  assert.match(fieldSheetCss, /\.bottom-sheet\.field-sheet-enhanced\[data-field-snap\]/u);
});

test("map-context Area and Street HUDs keep a compact shared header with a 44px close target", () => {
  assert.match(fieldSheetCss, /\.bottom-sheet\.field-sheet-enhanced\.compact-sheet,[\s\S]*?\.bottom-sheet\.field-sheet-enhanced\.task-sheet[\s\S]*?--field-hud-handle-min-height: 0\.78rem/u);
  assert.match(fieldSheetCss, /--field-hud-header-padding-top: 0;[\s\S]*?--field-hud-header-padding-bottom: 0;/u);
  assert.match(fieldSheetCss, /--field-hud-close-size: 2\.75rem/u);
  assert.match(fieldSheetCss, /\.compact-sheet \.sheet-header,[\s\S]*?\.task-sheet \.sheet-header[\s\S]*?min-height: var\(--field-hud-close-size\)/u);
});

test("launcher stays hidden for every open primary hub while menu opening closes the current hub", () => {
  assert.match(shell, /const openMenu = \(\) => \{\s*setPrimaryHub\(null\);\s*setMenuOpen\(true\);\s*\}/u);
  assert.match(shell, /const overlayOpen = menuOpen \|\| primaryHub !== null/u);
  assert.match(shell, /launcherAvailable && !overlayOpen \? \(/u);
  assert.doesNotMatch(shell, /is-above-hub|is-behind-menu/u);
});

test("Settings uses the same FieldHub root instead of the legacy bottom-sheet system", () => {
  assert.match(settingsSheet, /import \{ FieldHub \} from "\.\.\/platform\/FieldHub\.tsx"/u);
  assert.match(settingsSheet, /<FieldHub[\s\S]*?title=\{t\(language, "settings"\)\}[\s\S]*?className="settings-field-hub"/u);
  assert.doesNotMatch(settingsSheet, /className=\{`bottom-sheet settings-sheet/u);
  assert.doesNotMatch(settingsSheet, /className="sheet-handle-button"/u);
});

test("one upper sync status owns confirmation while the lower field bar stays clean", () => {
  assert.doesNotMatch(shell, /platform-sync-indicator/u);
  assert.match(syncStatus, /const serverConfirmed = state === "server-confirmed" && !issue;/u);
  assert.match(syncStatus, /is-server-confirmed is-compact/u);
  assert.match(syncStatus, /WAITING_SERVER_RECOVERY_MS = 8_000/u);
  assert.match(syncStatus, /WAITING_SERVER_STALL_MS = 30_000/u);
  assert.match(syncStatus, /flushRxdbDrafts\(\);[\s\S]*?manualRefreshCampaign\(\);/u);
  assert.match(syncStatus, /visibleState: MutationSyncState = stalled && state === "waiting-server" \? "failed" : state/u);
  assert.match(mainSource, /installRxdbFetchGuard\(\);/u);
  assert.match(syncCss, /\.mutation-sync-status \{[\s\S]*left: 0\.75rem;/u);
  assert.match(syncCss, /\.mutation-sync-status\.is-server-confirmed\.is-compact/u);
  assert.match(syncCss, /\.mutation-sync-status\.is-waiting-server/u);
});

test("join access uses a larger QR and compact inline copy icon controls", () => {
  assert.match(roomsHub, /QRCodeSVG value=\{issuedJoinUrl\} size=\{256\}/u);
  assert.match(roomsHub, /className="join-access-row"/u);
  assert.match(roomsHub, /join-access-copy-button/u);
  assert.match(roomsHub, /Room-Code kopieren/u);
  assert.match(roomsHub, /Join-Link kopieren/u);
  assert.match(joinAccessCss, /grid-template-columns: minmax\(0, 1fr\) 2\.35rem/u);
  assert.match(joinAccessCss, /\.join-access-qr svg[\s\S]*width: min\(16rem/u);
});

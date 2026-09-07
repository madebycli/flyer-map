import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const teamHub = readFileSync(new URL("../src/team/TeamHub.tsx", import.meta.url), "utf8");
const progressHub = readFileSync(new URL("../src/team/TeamProgressHub.tsx", import.meta.url), "utf8");
const progressPanel = readFileSync(new URL("../src/team/TeamProgressPanel.tsx", import.meta.url), "utf8");
const fieldSheet = readFileSync(new URL("../src/platform/FieldBottomSheet.tsx", import.meta.url), "utf8");
const fieldSheetCss = readFileSync(new URL("../src/platform/field-bottom-sheet.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/platform/PlatformShell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/platform/platform-shell.css", import.meta.url), "utf8");
const syncStatus = readFileSync(new URL("../src/sync/SyncStatus.tsx", import.meta.url), "utf8");

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

test("launcher remains reachable above a primary hub and opening it closes that hub", () => {
  assert.match(shell, /const openMenu = \(\) => \{\s*setPrimaryHub\(null\);\s*setMenuOpen\(true\);\s*\}/u);
  assert.match(shell, /primaryHub !== null \? "is-above-hub"/u);
  assert.match(shellCss, /\.platform-field-bar\.is-above-hub\s*\{\s*z-index:\s*3450;/u);
});

test("healthy server confirmation is represented only by the compact field indicator", () => {
  assert.match(syncStatus, /if \(state === "server-confirmed" && !issue\) return null;/u);
  assert.match(syncStatus, /state === "failed"/u);
  assert.match(syncStatus, /state === "blocked-auth"/u);
});

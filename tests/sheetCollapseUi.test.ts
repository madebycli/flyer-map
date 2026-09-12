import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("mission map sheets use universal FieldHub chrome while Settings does too", async () => {
  const [app, settings] = await Promise.all([
    readFile("src/App.tsx", "utf8"),
    readFile("src/settings/SettingsSheet.tsx", "utf8"),
  ]);
  assert.match(app, /import \{ FieldHub \} from "\.\/platform\/FieldHub\.tsx";/u);
  assert.match(app, /sheet === "area"[\s\S]*?<FieldHub[\s\S]*?map-area-hub/u);
  assert.match(app, /sheet === "task"[\s\S]*?<FieldHub[\s\S]*?map-task-hub/u);
  assert.match(app, /sheet === "house"[\s\S]*?<FieldHub[\s\S]*?map-house-hub/u);
  assert.doesNotMatch(app, /const sheetToggleLabel/u);
  assert.doesNotMatch(app, /sheet-handle-button/u);
  assert.match(settings, /<FieldHub[\s\S]*?title=\{t\(language, "settings"\)\}/u);
  assert.doesNotMatch(settings, /sheet-handle-button/u);
});

test("Team deletion remains an Admin-only destructive action with a local Area guard", async () => {
  const app = await readFile("src/App.tsx", "utf8");
  assert.match(app, /if \(!isAdmin\) return;[\s\S]*Team kann nicht gelöscht werden/u);
  assert.match(app, /Team „\$\{team\.name/u);
  assert.match(app, /disabled=\{snapshot\.areas\.some\(\(area\) => area\.teamId === team\.id\)\}/u);
  assert.match(app, /const deleteTeam = async \(team: Team\)[\s\S]*await postCampaignMutation\(/u);
  const deleteBlock = /const deleteTeam = async \(team: Team\)([\s\S]*?)\n  const startDrawing/u.exec(app)?.[1] ?? "";
  assert.doesNotMatch(deleteBlock, /commitSnapshot/u, "a constrained Team delete must not disappear locally before the server accepts it");
});

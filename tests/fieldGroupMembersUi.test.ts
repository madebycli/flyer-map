
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Rooms keeps manager member controls in the Plan 031 production component graph", async () => {
  const shell = await readFile("src/platform/PlatformShell.tsx", "utf8");
  const rooms = await readFile("src/team/RoomsHub.tsx", "utf8");
  const teamHub = await readFile("src/team/TeamHub.tsx", "utf8");
  const panel = await readFile("src/team/FieldGroupMembersPanel.tsx", "utf8");
  const styles = await readFile("src/team/field-group-members.css", "utf8");

  assert.match(shell, /<RoomsHub/u);
  assert.match(rooms, /import \{ FieldGroupMembersPanel \} from "\.\/FieldGroupMembersPanel\.tsx";/u);
  assert.match(rooms, /<FieldGroupMembersPanel/u);
  assert.match(rooms, /canManageGroup\(selectedGroup\)/u);
  assert.doesNotMatch(teamHub, /FieldGroupMembersPanel|Rooms/u);
  assert.match(panel, /fetchFieldGroupMembers/u);
  assert.match(panel, /removeFieldGroupMember/u);
  assert.match(panel, /Mitgliederverwaltung benötigt Internet/u);
  assert.match(styles, /\.field-group-members/u);
  assert.doesNotMatch(panel, /session_hash|secret_hash|qrToken|roomCode|cf-connecting-ip/iu);
});

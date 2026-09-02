import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Team Hub keeps manager member controls in the production component graph", async () => {
  const teamHub = await readFile("src/team/TeamHub.tsx", "utf8");
  const panel = await readFile("src/team/FieldGroupMembersPanel.tsx", "utf8");
  const styles = await readFile("src/team/field-group-members.css", "utf8");

  assert.match(teamHub, /import \{ FieldGroupMembersPanel \} from "\.\/FieldGroupMembersPanel\.tsx";/u);
  assert.match(teamHub, /<FieldGroupMembersPanel/u);
  assert.match(teamHub, /canManageGroup\(selectedGroup\).*selectedGroup\.state === "active"/su);
  assert.match(panel, /fetchFieldGroupMembers/u);
  assert.match(panel, /removeFieldGroupMember/u);
  assert.match(panel, /Mitgliederverwaltung benötigt Internet/u);
  assert.match(styles, /\.field-group-members/u);
  assert.doesNotMatch(panel, /session_hash|secret_hash|qrToken|roomCode|cf-connecting-ip/iu);
});

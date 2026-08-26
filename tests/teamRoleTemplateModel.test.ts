import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TEAM_ROLE_PRESETS,
  normalizeTeamRoleCapabilities,
  teamRolePresetById,
  toggleTeamRoleCapability,
} from "../src/admin/teamRoleTemplateModel.ts";

test("team member default contains own-team operational editing but no Team administration", () => {
  const member = teamRolePresetById("team-member");

  assert.ok(member.capabilities.includes("area.edit-own-team"));
  assert.ok(member.capabilities.includes("task.edit-own-team"));
  assert.equal(member.capabilities.includes("team.rename"), false);
  assert.equal(member.capabilities.includes("team.member-manage"), false);
  assert.equal(member.capabilities.some((value) => value.includes("other-team")), false);
});

test("team leader default is an operational superset with Team management", () => {
  const member = teamRolePresetById("team-member");
  const leader = teamRolePresetById("team-leader");

  for (const capability of member.capabilities) {
    assert.ok(leader.capabilities.includes(capability));
  }
  assert.ok(leader.capabilities.includes("team.rename"));
  assert.ok(leader.capabilities.includes("team.change-color"));
  assert.ok(leader.capabilities.includes("team.member-manage"));
  assert.ok(leader.capabilities.includes("invite.manage-own-team"));
  assert.ok(leader.capabilities.includes("live-group.manage"));
});

test("unknown or cross-scope capability text is rejected instead of silently accepted", () => {
  assert.throws(
    () => normalizeTeamRoleCapabilities(["task.edit-own-team", "task.edit-other-team"]),
    /unknown_team_role_capability/u,
  );
  assert.throws(
    () => normalizeTeamRoleCapabilities(["admin.manage"]),
    /unknown_team_role_capability/u,
  );
});

test("normalization deduplicates and keeps registry order", () => {
  assert.deepEqual(
    normalizeTeamRoleCapabilities([
      "task.delete",
      "area.edit-own-team",
      "task.delete",
      "team.rename",
    ]),
    ["area.edit-own-team", "task.delete", "team.rename"],
  );
});

test("toggle only changes one known capability and presets remain immutable copies", () => {
  const member = teamRolePresetById("team-member");
  const toggled = toggleTeamRoleCapability(member.capabilities, "team.rename");
  assert.ok(toggled.includes("team.rename"));

  const fresh = teamRolePresetById("team-member");
  assert.equal(fresh.capabilities.includes("team.rename"), false);
  assert.equal(DEFAULT_TEAM_ROLE_PRESETS.length, 2);
});

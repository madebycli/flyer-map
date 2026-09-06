import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AccessContext } from "../worker/access.ts";
import { fieldGroupListScope } from "../worker/organizationFieldGroupList.ts";
import { teamCommentScope } from "../worker/teamCommentsSummary.ts";

function access(role: AccessContext["role"], teamId: string | null = null): AccessContext {
  return {
    grantId: `grant_${role}`,
    campaignId: "campaign_a",
    role,
    teamId,
    label: role,
    ...(role === "field-group-member"
      ? { groupId: "field_group_a", membershipId: "membership_a" }
      : {}),
  };
}

test("room management visibility is independent from public discoverability", () => {
  const admin = fieldGroupListScope(access("admin"), null);
  assert.equal(admin.ok, true);
  if (admin.ok) assert.equal(admin.discoverableOnly, false);

  const editor = fieldGroupListScope(access("team-editor", "team_a"), null);
  assert.equal(editor.ok, true);
  if (editor.ok) {
    assert.equal(editor.teamId, "team_a");
    assert.equal(editor.discoverableOnly, false);
  }

  const viewer = fieldGroupListScope(access("viewer"), null);
  assert.equal(viewer.ok, true);
  if (viewer.ok) assert.equal(viewer.discoverableOnly, true);
});

test("team editors and room members cannot list foreign team rooms", () => {
  const editor = fieldGroupListScope(access("team-editor", "team_a"), "team_b");
  assert.equal(editor.ok, false);
  if (!editor.ok) assert.equal(editor.code, "group_scope_forbidden");

  const member = fieldGroupListScope(access("field-group-member", "team_a"), "team_b");
  assert.equal(member.ok, false);
  if (!member.ok) assert.equal(member.code, "group_scope_forbidden");
});

test("team comment summary is tenant/team scoped on the server", () => {
  const adminAll = teamCommentScope(access("admin"), "all");
  assert.deepEqual(adminAll, { ok: true, teamId: null, includeCampaign: true });

  const own = teamCommentScope(access("team-editor", "team_a"), "team_a");
  assert.deepEqual(own, { ok: true, teamId: "team_a", includeCampaign: false });

  const foreign = teamCommentScope(access("team-editor", "team_a"), "team_b");
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.code, "team_scope_forbidden");
});

test("team center explains that hidden rooms remain joinable by code and QR", async () => {
  const source = await readFile(new URL("../src/team/TeamCenter.tsx", import.meta.url), "utf8");
  assert.match(source, /Ausgeschaltet bleibt der Room trotzdem erstellt und per Code\/QR erreichbar/u);
  assert.match(source, /Room-Code und QR-Link funktionieren in beiden Zuständen/u);
  assert.match(source, /Mit Code beitreten/u);
  assert.match(source, /Aktive unterwegs/u);
});

test("new-device onboarding happens after successful QR redemption", async () => {
  const source = await readFile(new URL("../src/access/FieldGroupJoinGate.tsx", import.meta.url), "utf8");
  const success = source.indexOf(".then(() =>");
  const scrub = source.indexOf("removeFieldGroupQrTokenFromUrl();");
  const intro = source.indexOf('setPhase("intro")');
  assert.ok(success >= 0 && scrub > success && intro > scrub);
  assert.match(source, /GROUP_ONBOARDING_KEY/u);
});

test("admin invite center is a first-class route", async () => {
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /window\.location\.pathname === "\/admin\/invites"/u);
  assert.match(main, /OrganizationInviteCenter/u);
  assert.match(main, /AccessLinkOnboardingGate/u);
});


test("active field-group endpoint uses manager-scoped listing and manager-only reveal", async () => {
  const source = await readFile(new URL("../worker/fieldGroups.ts", import.meta.url), "utf8");
  assert.match(source, /async function listManagedGroups/u);
  assert.match(source, /access\.role === "team-editor"/u);
  assert.match(source, /access\.role === "viewer"[\s\S]*listDiscoverableGroups/u);
  assert.match(source, /async function revealCredentials/u);
  assert.match(source, /requireManagedGroup\(db, campaignId, groupId, access\)/u);
  assert.match(source, /field_group_recoverable_credentials/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildLiveGroupCreateDraft } from "../src/domain/liveGroupDraft.ts";

const allowedTeams = ["team_alpha", "team_beta"];

test("new Live Group draft defaults to active and discoverable", () => {
  assert.deepEqual(
    buildLiveGroupCreateDraft({ label: "  Gruppe  1  ", teamId: "team_alpha" }, allowedTeams),
    {
      label: "Gruppe 1",
      teamId: "team_alpha",
      discoverable: true,
      state: "active",
    },
  );
});

test("creator may explicitly disable discoverability", () => {
  const draft = buildLiveGroupCreateDraft(
    { label: "Auto 2", teamId: "team_beta", discoverable: false },
    allowedTeams,
  );
  assert.equal(draft.discoverable, false);
});

test("draft rejects Team ids outside caller scope", () => {
  assert.throws(
    () => buildLiveGroupCreateDraft({ label: "Fremd", teamId: "team_other" }, allowedTeams),
    /invalid_live_group_team/u,
  );
});

test("draft shape stays limited to local creation fields", () => {
  const draft = buildLiveGroupCreateDraft(
    { label: "Team unterwegs", teamId: "team_alpha" },
    allowedTeams,
  );
  assert.deepEqual(Object.keys(draft).sort(), ["discoverable", "label", "state", "teamId"]);
});

test("label is bounded and empty labels are rejected", () => {
  assert.throws(
    () => buildLiveGroupCreateDraft({ label: "   ", teamId: "team_alpha" }, allowedTeams),
    /invalid_live_group_label/u,
  );
  assert.throws(
    () => buildLiveGroupCreateDraft({ label: "x".repeat(81), teamId: "team_alpha" }, allowedTeams),
    /invalid_live_group_label/u,
  );
});

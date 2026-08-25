import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LIVE_GROUP_FILTER,
  liveGroupTeamFilters,
  visibleLiveGroups,
  type LiveGroupDiscoveryItem,
} from "../src/domain/liveGroupDiscovery.ts";

const groups: LiveGroupDiscoveryItem[] = [
  {
    id: "group_a",
    campaignId: "campaign_1",
    teamId: "team_orange",
    teamName: "Team Orange",
    teamColor: "#ea580c",
    label: "Gruppe 1",
    state: "active",
    discoverable: true,
    joinAvailable: true,
  },
  {
    id: "group_b",
    campaignId: "campaign_1",
    teamId: "team_blue",
    teamName: "Team Blau",
    teamColor: "#2563eb",
    label: "Gruppe 2",
    state: "active",
    discoverable: true,
    joinAvailable: true,
  },
  {
    id: "group_hidden",
    campaignId: "campaign_1",
    teamId: "team_orange",
    teamName: "Team Orange",
    teamColor: "#ea580c",
    label: "Versteckt",
    state: "active",
    discoverable: false,
    joinAvailable: true,
  },
  {
    id: "group_other_campaign",
    campaignId: "campaign_2",
    teamId: "team_other",
    teamName: "Fremdes Team",
    teamColor: "#000000",
    label: "Fremd",
    state: "active",
    discoverable: true,
    joinAvailable: true,
  },
];

test("default discovery shows all active discoverable groups in the current Campaign", () => {
  assert.deepEqual(
    visibleLiveGroups(groups, "campaign_1", DEFAULT_LIVE_GROUP_FILTER).map((group) => group.id),
    ["group_a", "group_b"],
  );
});

test("Team filter narrows the current Campaign list without widening scope", () => {
  assert.deepEqual(
    visibleLiveGroups(groups, "campaign_1", { scope: "team", teamId: "team_orange" }).map(
      (group) => group.id,
    ),
    ["group_a"],
  );
});

test("non-discoverable and other-Campaign groups never appear in filters", () => {
  assert.deepEqual(liveGroupTeamFilters(groups, "campaign_1"), [
    { teamId: "team_blue", teamName: "Team Blau", teamColor: "#2563eb" },
    { teamId: "team_orange", teamName: "Team Orange", teamColor: "#ea580c" },
  ]);
});

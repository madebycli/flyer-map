
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const teamHubSource = readFileSync(new URL("../src/team/TeamHub.tsx", import.meta.url), "utf8");
const progressHubSource = readFileSync(new URL("../src/team/TeamProgressHub.tsx", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("../src/team/TeamProgressPanel.tsx", import.meta.url), "utf8");

test("Team Hub is focused and progress is its own primary surface", () => {
  assert.doesNotMatch(teamHubSource, /TeamCenter|team-center-tabs|Rooms|Kommentare/u);
  assert.match(progressHubSource, /<TeamProgressPanel/u);
  assert.match(progressHubSource, /context\?\.activeTeam/u);
});

test("Team progress reads a canonical snapshot and keeps Street and House denominators separate", () => {
  assert.match(progressSource, /fetchCampaignSnapshot\(campaignId\)/u);
  assert.match(progressSource, /calculateTeamProgress\(snapshot, teamId\)/u);
  assert.match(progressSource, /calculateTeamHouseProgress\(snapshot, teamId\)/u);
  assert.match(progressSource, />Straßen</u);
  assert.match(progressSource, />Häuser</u);
});

test("offline Team progress is explicitly sourced from the local campaign snapshot", () => {
  assert.match(progressSource, /loadCampaignSnapshot\(\)\.snapshot/u);
  assert.match(progressSource, /source === "local" \? "Lokaler Stand" : "Serverstand"/u);
});

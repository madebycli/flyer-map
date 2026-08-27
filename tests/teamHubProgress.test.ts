import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hubSource = readFileSync(new URL("../src/team/TeamHub.tsx", import.meta.url), "utf8");
const progressSource = readFileSync(
  new URL("../src/team/TeamProgressPanel.tsx", import.meta.url),
  "utf8",
);

test("Team Hub renders the real progress panel instead of a null placeholder", () => {
  assert.match(hubSource, /<TeamProgressPanel/);
  assert.doesNotMatch(hubSource, /const progress = useMemo\([\s\S]{0,180}return null;/u);
});

test("Team progress reads a canonical snapshot and keeps Street and House denominators separate", () => {
  assert.match(progressSource, /fetchCampaignSnapshot\(campaignId\)/);
  assert.match(progressSource, /calculateTeamProgress\(snapshot, teamId\)/);
  assert.match(progressSource, /calculateTeamHouseProgress\(snapshot, teamId\)/);
  assert.match(progressSource, />Straßen</);
  assert.match(progressSource, />Häuser</);
});

test("offline Team progress is explicitly sourced from the local campaign snapshot", () => {
  assert.match(progressSource, /loadCampaignSnapshot\(\)\.snapshot/);
  assert.match(progressSource, /source === "local" \? "Lokaler Stand" : "Serverstand"/);
});

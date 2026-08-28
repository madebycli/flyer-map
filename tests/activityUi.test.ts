import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Activity uses the real production launcher graph and bounded read client", async () => {
  const [worker, api, shell, hub, css, contract] = await Promise.all([
    readFile("worker/activity.ts", "utf8"),
    readFile("src/data/activityApi.ts", "utf8"),
    readFile("src/platform/PlatformShell.tsx", "utf8"),
    readFile("src/collaboration/ActivityHub.tsx", "utf8"),
    readFile("src/collaboration/activity-hub.css", "utf8"),
    readFile("src/platform/platformContract.ts", "utf8"),
  ]);

  assert.match(worker, /domain_events/u);
  assert.match(worker, /automation\.executed/u);
  assert.match(worker, /COMPLETE_PARENT_STREET_RULE_TYPE/u);
  assert.match(worker, /LIMIT \?/u);
  assert.match(worker, /ORDER BY e\.occurred_at DESC, e\.id DESC/u);
  assert.match(worker, /payload_json/u);
  assert.match(api, /credentials: "same-origin"/u);
  assert.match(api, /cache: "no-store"/u);
  assert.match(api, /cursor/u);
  assert.match(contract, /id: "activity"/u);
  assert.match(contract, /label: "Aktivität"/u);
  assert.match(shell, /<ActivityHub/u);
  assert.match(shell, /activityOpen/u);
  assert.match(hub, /Aktivität wird geladen/u);
  assert.match(hub, /Noch keine Aktivität vorhanden/u);
  assert.match(hub, /Erneut laden/u);
  assert.match(hub, /Mehr laden/u);
  assert.match(hub, /automatisch abgeschlossen/u);
  assert.match(hub, /bereits geladene Aktivität bleibt sichtbar/u);
  assert.doesNotMatch(hub, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(hub, /fake|mock|Workbench/iu);
  assert.match(css, /min-height: 2\.55rem/u);
  assert.match(css, /max-height: min\(92dvh/u);
});

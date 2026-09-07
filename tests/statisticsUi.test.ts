
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("full Stats remains implemented while Plan 031 promotes focused Fortschritt instead", async () => {
  const [worker, api, shell, hub, progressHub, css, domain, contract] = await Promise.all([
    readFile("worker/statistics.ts", "utf8"),
    readFile("src/data/statisticsApi.ts", "utf8"),
    readFile("src/platform/PlatformShell.tsx", "utf8"),
    readFile("src/collaboration/StatisticsHub.tsx", "utf8"),
    readFile("src/team/TeamProgressHub.tsx", "utf8"),
    readFile("src/collaboration/statistics-hub.css", "utf8"),
    readFile("src/domain/statistics.ts", "utf8"),
    readFile("src/platform/platformContract.ts", "utf8"),
  ]);

  assert.match(worker, /domain_events/u);
  assert.match(worker, /field_sessions/u);
  assert.match(worker, /LIMIT \?/u);
  assert.match(worker, /PROGRESS_HISTORY_DAYS = 90/u);
  assert.match(worker, /teamPredicate/u);
  assert.match(worker, /field_group_id/u);
  assert.doesNotMatch(worker, /SELECT \* /u);
  assert.match(api, /credentials: "same-origin"/u);
  assert.match(api, /cache: "no-store"/u);
  assert.doesNotMatch(shell, /<StatisticsHub|statisticsOpen/u);
  assert.match(shell, /<TeamProgressHub/u);
  assert.match(contract, /label: "Fortschritt"/u);
  assert.match(progressHub, /<TeamProgressPanel/u);
  assert.match(hub, /Stats werden geladen/u);
  assert.match(hub, /Noch keine Aufgaben oder Einsätze vorhanden/u);
  assert.match(hub, /Erneut laden/u);
  assert.match(hub, /Offline: bereits geladene Stats bleiben sichtbar/u);
  assert.match(hub, /Mehr|Weitere Einsätze/u);
  assert.doesNotMatch(hub, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(hub, /fake|mock|Workbench/iu);
  assert.match(css, /min-height: 2\.55rem/u);
  assert.match(domain, /denominator: "street-tasks" \| "house-tasks"/u);
});

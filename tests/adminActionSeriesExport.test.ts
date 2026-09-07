import assert from "node:assert/strict";
import test from "node:test";
import type { AdminAnalyticsExportInput } from "../src/domain/adminAnalyticsExport.ts";
import { buildAdminActionSeriesExport } from "../src/domain/adminActionSeriesExport.ts";

function action(name: string, completed: number, personMinutes: number): AdminAnalyticsExportInput {
  return {
    actionName: name,
    templateName: "Standard Ort",
    mode: "distribution",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [{
      teamLabel: "Orange",
      distribution: {
        total: 100,
        completed,
        open: 100 - completed,
        later: 0,
        notDeliverable: 0,
      },
      pickupTotal: 0,
      pickupCollected: 0,
      sessionCount: 2,
      personMinutes,
    }],
    areas: [],
    sessions: [],
    events: [],
  };
}

test("series export creates comparison data, CSV and a planning prompt", () => {
  const pkg = buildAdminActionSeriesExport([
    action("Frühjahr 2026", 80, 600),
    action("Herbst 2026", 90, 520),
  ]);

  assert.match(pkg.files["comparison.json"], /completedDelta/u);
  assert.match(pkg.files["actions.csv"], /Frühjahr 2026/u);
  assert.match(pkg.files["AI_VERGLEICHS_PROMPT.md"], /priorisierte Verbesserungsmaßnahmen/u);
  assert.match(pkg.files["AI_VERGLEICHS_PROMPT.md"], /keine Bewertung einzelner Personen/iu);
});

test("series prompt warns that changed workload can distort direct comparisons", () => {
  const pkg = buildAdminActionSeriesExport([action("A", 50, 100)]);
  assert.match(pkg.files["AI_VERGLEICHS_PROMPT.md"], /Gebietsumfang.*Teamzuschnitt.*Aufgabenmenge/isu);
});

test("series CSV neutralizes formula-like action names", () => {
  const pkg = buildAdminActionSeriesExport([action("=CMD()", 50, 100)]);
  assert.match(pkg.files["actions.csv"], /'=CMD\(\)/u);
});

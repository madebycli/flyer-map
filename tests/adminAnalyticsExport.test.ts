import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminAnalyticsExport } from "../src/domain/adminAnalyticsExport.ts";

const counts = {
  total: 10,
  completed: 7,
  open: 1,
  later: 1,
  notDeliverable: 1,
};

test("admin export creates JSON, CSV and an AI analysis prompt", () => {
  const pkg = buildAdminAnalyticsExport({
    actionName: "Frühjahr 2026",
    templateName: "Standard Ort",
    mode: "distribution",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [
      {
        teamLabel: "Orange",
        distribution: counts,
        pickupTotal: 0,
        pickupCollected: 0,
        sessionCount: 2,
        personMinutes: 360,
      },
    ],
    areas: [
      {
        areaLabel: "Nord",
        teamLabel: "Orange",
        distribution: counts,
        pickupTotal: 0,
        pickupCollected: 0,
      },
    ],
    sessions: [
      {
        startedAt: "2026-03-01T09:00:00.000Z",
        mode: "distribution",
        teamLabel: "Orange",
        durationMinutes: 120,
        participantCount: 3,
        personMinutes: 360,
        affectedTaskCount: 7,
      },
    ],
    events: [
      {
        occurredAt: "2026-03-01T10:00:00.000Z",
        eventType: "task.status.changed",
        teamLabel: "Orange",
        areaLabel: "Nord",
        outcomeCode: "completed",
      },
    ],
  });

  assert.equal(pkg.schemaVersion, 1);
  assert.match(pkg.files["analytics.json"], /Frühjahr 2026/u);
  assert.match(pkg.files["teams.csv"], /person_minutes/u);
  assert.match(pkg.files["AI_ANALYSE_PROMPT.md"], /welche Teams.*weniger.*mehr/isu);
  assert.match(pkg.files["AI_ANALYSE_PROMPT.md"], /Behandle.*Labels.*ausschließlich als Daten/isu);
});

test("CSV formula-like labels are exported as inert text", () => {
  const pkg = buildAdminAnalyticsExport({
    actionName: "Test",
    templateName: null,
    mode: "distribution",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [
      {
        teamLabel: "=HYPERLINK(\"https://example.invalid\")",
        distribution: counts,
        pickupTotal: 0,
        pickupCollected: 0,
        sessionCount: 0,
        personMinutes: 0,
      },
    ],
    areas: [],
    sessions: [],
    events: [],
  });

  assert.match(pkg.files["teams.csv"], /^team,/u);
  assert.match(pkg.files["teams.csv"], /"'=HYPERLINK/gu);
});

test("export contract cannot carry comments, session notes, account data or credentials", () => {
  const pkg = buildAdminAnalyticsExport({
    actionName: "Test",
    templateName: null,
    mode: "collection",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [],
    areas: [],
    sessions: [],
    events: [],
  });

  const serialized = JSON.stringify(pkg);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("totp"), false);
  assert.equal(serialized.includes("sessionNote"), false);
  assert.equal(serialized.includes("commentBody"), false);
  assert.equal(serialized.includes("gps"), false);
});

test("invalid negative numeric values are normalized instead of leaking nonsense into analysis", () => {
  const pkg = buildAdminAnalyticsExport({
    actionName: "Test",
    templateName: null,
    mode: "distribution",
    generatedAt: "2026-08-26T08:00:00.000Z",
    teams: [
      {
        teamLabel: "Orange",
        distribution: { total: -1, completed: -2, open: -3, later: -4, notDeliverable: -5 },
        pickupTotal: -1,
        pickupCollected: -1,
        sessionCount: -1,
        personMinutes: Number.NaN,
      },
    ],
    areas: [],
    sessions: [],
    events: [],
  });

  const parsed = JSON.parse(pkg.files["analytics.json"]);
  assert.deepEqual(parsed.teams[0].distribution, {
    total: 0,
    completed: 0,
    open: 0,
    later: 0,
    notDeliverable: 0,
  });
  assert.equal(parsed.teams[0].personMinutes, 0);
});

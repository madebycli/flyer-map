import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { deriveMutationFromRxdbWrite } from "../src/domain/rxdbMutationAdapter.ts";

const stamp = "2026-09-02T09:00:00.000Z";

function snapshot(): CampaignSnapshot {
  return {
    schemaVersion: 3,
    revision: 4,
    campaign: { id: "campaign_rxdb", name: "Mission", status: "active", defaultMapView: null, createdAt: stamp, updatedAt: stamp },
    teams: [{ id: "team_a", campaignId: "campaign_rxdb", name: "Team A", color: "#2563eb", createdAt: stamp, updatedAt: stamp }],
    areas: [{ id: "area_a", campaignId: "campaign_rxdb", teamId: "team_a", name: "Gebiet A", geometry: { type: "Polygon", coordinates: [[[8.6, 49.4], [8.61, 49.4], [8.61, 49.41], [8.6, 49.4]]] }, createdAt: stamp, updatedAt: stamp }],
    tasks: [{ id: "task_a", campaignId: "campaign_rxdb", areaId: "area_a", taskType: "street", label: "Straße A", geometry: { type: "LineString", coordinates: [[8.6, 49.4], [8.61, 49.41]] }, status: "open", completedAt: null, createdAt: stamp, updatedAt: stamp }],
    houseTasks: [],
  };
}

test("RxDB merges independent Team name and color writes", () => {
  const current = snapshot();
  current.teams[0] = { ...current.teams[0], name: "Panthers", updatedAt: "2026-09-02T09:01:00.000Z" };
  const assumed = { ...snapshot().teams[0] };
  const decision = deriveMutationFromRxdbWrite("teams", current, {
    assumedMasterState: assumed,
    newDocumentState: { ...assumed, color: "#15803d", updatedAt: "2026-09-02T09:02:00.000Z" },
  }, "2026-09-02T09:03:00.000Z");

  assert.equal(decision.kind, "apply");
  if (decision.kind !== "apply" || decision.mutation.type !== "team.update") return;
  assert.equal(decision.mutation.payload.name, undefined);
  assert.equal(decision.mutation.payload.color, "#15803d");
  assert.equal(decision.mutation.payload.expectedUpdatedAt, "2026-09-02T09:01:00.000Z");
  assert.match(decision.mutation.id, /^mutation_rxdb_/u);
});

test("RxDB resolves a same-Team-field race to canonical master without poisoning other collections", () => {
  const current = snapshot();
  current.teams[0] = { ...current.teams[0], color: "#be123c", updatedAt: "2026-09-02T09:01:00.000Z" };
  const assumed = { ...snapshot().teams[0] };
  const teamDecision = deriveMutationFromRxdbWrite("teams", current, {
    assumedMasterState: assumed,
    newDocumentState: { ...assumed, color: "#15803d" },
  }, "2026-09-02T09:03:00.000Z");
  assert.deepEqual(teamDecision, { kind: "conflict", reason: "team_field_changed" });

  const task = current.tasks[0];
  const statusDecision = deriveMutationFromRxdbWrite("streetTasks", current, {
    assumedMasterState: task,
    newDocumentState: { ...task, status: "completed", completedAt: "2026-09-02T09:04:00.000Z" },
  }, "2026-09-02T09:04:00.000Z");
  assert.equal(statusDecision.kind, "apply");
  if (statusDecision.kind !== "apply") return;
  assert.equal(statusDecision.mutation.type, "task.set-status");
});

test("same Street status races resolve to the canonical server document", () => {
  const current = snapshot();
  current.tasks[0] = { ...current.tasks[0], status: "later", updatedAt: "2026-09-02T09:01:00.000Z" };
  const assumed = snapshot().tasks[0];
  const decision = deriveMutationFromRxdbWrite("streetTasks", current, {
    assumedMasterState: assumed,
    newDocumentState: { ...assumed, status: "completed", completedAt: "2026-09-02T09:02:00.000Z" },
  }, "2026-09-02T09:03:00.000Z");
  assert.deepEqual(decision, { kind: "conflict", reason: "task_status_changed" });
});

test("an update never resurrects a document deleted on the server", () => {
  const current = snapshot();
  current.tasks = [];
  const assumed = snapshot().tasks[0];
  const decision = deriveMutationFromRxdbWrite("streetTasks", current, {
    assumedMasterState: assumed,
    newDocumentState: { ...assumed, label: "Neue Beschriftung" },
  }, "2026-09-02T09:03:00.000Z");
  assert.deepEqual(decision, { kind: "conflict", reason: "target_deleted" });
});

test("an unchanged canonical tombstone derives the narrow delete mutation", () => {
  const current = snapshot();
  const team = current.teams[0];
  const decision = deriveMutationFromRxdbWrite("teams", current, {
    assumedMasterState: { ...team, campaignId: current.campaign.id },
    newDocumentState: { ...team, campaignId: current.campaign.id, _deleted: true },
  }, "2026-09-02T12:00:00.000Z");

  assert.equal(decision.kind, "apply");
  if (decision.kind === "apply") {
    assert.equal(decision.mutation.type, "team.delete");
    assert.equal(decision.mutation.payload.teamId, team.id);
  }
});

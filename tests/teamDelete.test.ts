import assert from "node:assert/strict";
import test from "node:test";
import type { CampaignSnapshot } from "../src/domain/campaign.ts";
import { deriveCampaignMutation, MutationDerivationError } from "../src/domain/mutationDiff.ts";
import { applyCampaignMutation, CampaignMutationConflictError, type CampaignMutation } from "../src/domain/mutations.ts";
import { validateCampaignMutation } from "../worker/mutationValidation.ts";
import { teamDeleteBlocker } from "../worker/mutationRepository.ts";
import { handleCampaignMutation } from "../worker/mutationHandler.ts";
import type { AccessContext } from "../worker/access.ts";
import type { D1DatabaseLike, D1PreparedStatement } from "../worker/campaignRepository.ts";

const stamp = "2026-09-02T10:00:00.000Z";
const campaignId = "campaign_team_delete";

function snapshot(withArea = false): CampaignSnapshot {
  return {
    schemaVersion: 3, revision: 4,
    campaign: { id: campaignId, name: "Aktion", status: "active", defaultMapView: null, createdAt: stamp, updatedAt: stamp },
    teams: [{ id: "team_empty", campaignId, name: "Leer", color: "#2563eb", createdAt: stamp, updatedAt: stamp }],
    areas: withArea ? [{ id: "area_a", campaignId, teamId: "team_empty", name: "Gebiet", geometry: { type: "Polygon", coordinates: [[[8, 49], [8.1, 49], [8, 49]]] }, createdAt: stamp, updatedAt: stamp }] : [],
    tasks: [],
  };
}

function mutation(expectedUpdatedAt = stamp): CampaignMutation {
  return { id: "mutation_team_delete", campaignId, type: "team.delete", payload: { teamId: "team_empty", expectedUpdatedAt }, baseRevision: 4, createdAt: "2026-09-02T10:01:00.000Z" };
}

test("derives team.delete only for one otherwise isolated Team removal", () => {
  const previous = snapshot();
  const next = { ...previous, revision: 5, campaign: { ...previous.campaign, updatedAt: "2026-09-02T10:01:00.000Z" }, teams: [] };
  const derived = deriveCampaignMutation(previous, next);
  assert.equal(derived?.type, "team.delete");
  assert.deepEqual(derived && "payload" in derived ? derived.payload : null, { teamId: "team_empty", expectedUpdatedAt: stamp });
});

test("does not derive a pseudo-cascade when a Team and its Area disappear together", () => {
  const previous = snapshot(true);
  const next = { ...previous, revision: 5, campaign: { ...previous.campaign, updatedAt: "2026-09-02T10:01:00.000Z" }, teams: [], areas: [] };
  assert.throws(() => deriveCampaignMutation(previous, next), MutationDerivationError);
});

test("applies an empty Team delete without cascading unrelated entities", () => {
  const current = snapshot();
  const next = applyCampaignMutation(current, mutation());
  assert.equal(next.teams.length, 0);
  assert.deepEqual(next.areas, current.areas);
  assert.deepEqual(next.tasks, current.tasks);
});

test("rejects missing, changed and Area-backed Team deletes", () => {
  assert.throws(() => applyCampaignMutation(snapshot(), mutation("2026-09-02T10:00:01.000Z")), (error) => error instanceof CampaignMutationConflictError && error.reason === "team_changed");
  assert.throws(() => applyCampaignMutation({ ...snapshot(), teams: [] }, mutation()), (error) => error instanceof CampaignMutationConflictError && error.reason === "team_missing");
  assert.throws(() => applyCampaignMutation(snapshot(true), mutation()), (error) => error instanceof CampaignMutationConflictError && error.reason === "team_has_areas");
});

test("validates the typed expectedUpdatedAt Team delete payload", () => {
  assert.equal(validateCampaignMutation(mutation(), campaignId).valid, true);
  assert.equal(validateCampaignMutation({ ...mutation(), payload: { teamId: "team_empty" } }, campaignId).valid, false);
});

test("mutation endpoint denies Team Editor, Viewer and Field Group Member before persistence", async () => {
  const forbiddenRoles: AccessContext["role"][] = ["team-editor", "viewer", "field-group-member"];
  const unusedDb: D1DatabaseLike = {
    prepare: () => { throw new Error("must_not_persist"); },
    async batch() { throw new Error("must_not_persist"); },
  };
  for (const role of forbiddenRoles) {
    const response = await handleCampaignMutation(
      new Request("https://example.test/api/campaigns/x/mutations", { method: "POST", body: JSON.stringify({ mutation: mutation() }) }),
      unusedDb,
      campaignId,
      { grantId: `grant_${role}`, campaignId, role, teamId: role === "viewer" ? null : "team_empty", label: null },
    );
    assert.equal(response.status, 403);
  }
});

class DependencyStatement implements D1PreparedStatement {
  values: unknown[] = [];
  constructor(readonly query: string, private readonly db: DependencyDb) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async first<T>() {
    const table = ["areas", "field_groups", "field_sessions", "domain_events", "campaign_access_grants"].find((name) => this.query.includes(`FROM ${name}`));
    return (table && this.db.rows.has(table) ? { present: 1 } : null) as T | null;
  }
  async all<T>() {
    const table = /PRAGMA table_info\(([^)]+)\)/u.exec(this.query)?.[1] ?? "";
    const columns = this.db.missing.has(table) ? [] : this.db.columns.get(table) ?? [];
    return { results: columns.map((name) => ({ name } as T)) };
  }
}
class DependencyDb implements D1DatabaseLike {
  rows = new Set<string>(); missing = new Set<string>();
  columns = new Map<string, string[]>([
    ["areas", ["campaign_id", "team_id"]], ["field_groups", ["campaign_id", "team_id"]],
    ["field_sessions", ["campaign_id", "team_id"]], ["domain_events", ["campaign_id", "team_id"]],
    ["campaign_access_grants", ["campaign_id", "team_id", "revoked_at"]],
  ]);
  prepare(query: string) { return new DependencyStatement(query, this); }
  async batch() { return []; }
}

for (const [table, expected] of [
  ["areas", "team_delete_has_areas"], ["field_groups", "team_delete_has_field_groups"],
  ["field_sessions", "team_delete_has_sessions"], ["domain_events", "team_delete_has_history"],
  ["campaign_access_grants", "team_delete_has_access_grants"],
] as const) {
  test(`blocks a Team delete with ${table}`, async () => {
    const db = new DependencyDb(); db.rows.add(table);
    assert.equal(await teamDeleteBlocker(db, campaignId, "team_empty"), expected);
  });
}

test("allows an empty canonical dependency set but fails safely for missing schema", async () => {
  const clean = new DependencyDb();
  assert.equal(await teamDeleteBlocker(clean, campaignId, "team_empty"), null);
  clean.missing.add("field_groups");
  assert.equal(await teamDeleteBlocker(clean, campaignId, "team_empty"), "team_delete_schema_unavailable");
});

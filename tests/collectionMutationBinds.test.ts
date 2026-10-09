import assert from "node:assert/strict";
import test from "node:test";
import { collectionMutationStatements } from "../worker/collectionMutationRepository.ts";
import type { CollectionMutation } from "../src/domain/mutations.ts";

/** Every SQL statement must receive exactly as many values as it has `?` placeholders: a missing bind shifts all later values and the UPDATE silently matches nothing. */
type Captured = { sql: string; args: unknown[] };
const fakeDb = (captured: Captured[]) => ({
  prepare(sql: string) {
    return { bind(...args: unknown[]) { const statement = { sql, args }; captured.push(statement); return statement; }, async run() { return {}; }, async all() { return { results: [] }; }, async first() { return null; } };
  },
  async batch() { return []; },
}) as never;

const geometry = { type: "Polygon", coordinates: [[[13, 51], [13.1, 51], [13.1, 51.1], [13, 51]]] };
const base = { campaignId: "campaign_binds", baseRevision: 1, createdAt: "2026-10-09T10:00:00.000Z" };
const at = "2026-10-09T09:00:00.000Z";

const mutations: Array<[string, unknown]> = [
  ["collection.main-area.create", { mainAreaId: "m1", name: "Sammelgebiet", geometry }],
  ["collection.main-area.update", { mainAreaId: "m1", name: "Sammelgebiet", geometry, expectedUpdatedAt: at }],
  ["collection.area.create", { areaId: "a1", mainAreaId: "m1", name: "West", geometry, color: "#2563eb" }],
  ["collection.area.update", { areaId: "a1", name: "West", geometry, color: "#e5736b", expectedUpdatedAt: at }],
  ["collection.area.archive", { areaId: "a1", expectedUpdatedAt: at }],
  ["collection.run.start", { runId: "r1", memberId: "mem1", mainAreaId: "m1", collectorId: "c1", label: "Nutzer 1" }],
  ["collection.run.claim-areas", { runId: "r1", collectorId: "c1", collectorLabel: "Nutzer 1", areaIds: ["a1"] }],
  ["collection.run.start-area", { runId: "r1", collectorId: "c1", areaId: "a1" }],
  ["collection.run.join", { runId: "r1", memberId: "mem2", collectorId: "c2", label: "Nutzer 2" }],
  ["collection.run.leave", { runId: "r1", collectorId: "c2" }],
  ["collection.run.release-area", { runId: "r1", areaId: "a1", collectorId: "c1" }],
  ["collection.admin.force-release-area", { runId: "r1", areaId: "a1", adminId: "admin_1" }],
  ["collection.run.complete-area", { runId: "r1", areaId: "a1", collectorId: "c1" }],
  ["collection.run.close", { runId: "r1", collectorId: "c1" }],
  ["collection.run.cancel", { runId: "r1", collectorId: "c1" }],
];

for (const [type, payload] of mutations) {
  test(`${type}: every placeholder gets exactly one value`, () => {
    const captured: Captured[] = [];
    collectionMutationStatements(fakeDb(captured), { ...base, id: "mutation_binds", type, payload } as unknown as CollectionMutation, "token");
    assert.ok(captured.length > 0, "the mutation writes something");
    for (const { sql, args } of captured) {
      const placeholders = (sql.match(/\?/gu) ?? []).length;
      assert.equal(args.length, placeholders, `${sql.replace(/\s+/gu, " ").slice(0, 90)}… binds ${args.length} values for ${placeholders} placeholders`);
      assert.ok(!args.includes(undefined), "no undefined value is bound");
    }
  });
}

test("a Teilgebiet update writes name, outline and colour (the colour was once missing and the update matched no row)", () => {
  const captured: Captured[] = [];
  collectionMutationStatements(fakeDb(captured), { ...base, id: "mutation_c", type: "collection.area.update", payload: { areaId: "a1", name: "Zentrum", geometry, color: "#e5736b", expectedUpdatedAt: at } } as unknown as CollectionMutation, "token");
  const [name, outline, color, updatedAt, id, campaign, expected] = captured[0].args;
  assert.deepEqual([name, color, updatedAt, id, campaign, expected], ["Zentrum", "#e5736b", base.createdAt, "a1", "campaign_binds", at]);
  assert.equal(outline, JSON.stringify(geometry));
});

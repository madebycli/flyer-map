import assert from "node:assert/strict";
import test from "node:test";
import { pointInOrOnPolygon } from "../src/domain/areaTaskPreparation.ts";
import { STREET_ENGINE_ALGORITHM_VERSION, StreetPreparationLimitError, prepareStreetsForArea } from "../worker/streetPreparation/engine.ts";
import { streetRoadEligibility } from "../worker/streetPreparation/roadEligibility.ts";
import {
  streetEngineMatrixArea,
  streetEngineMatrixRoads,
} from "./fixtures/streetEngineMatrix.ts";

test("the fixture matrix produces exact in-area fragments and diagnostics", () => {
  const prepared = prepareStreetsForArea({
    campaignId: "campaign_engine",
    areaId: "area_u",
    area: streetEngineMatrixArea,
    generation: "generation-1",
    roads: streetEngineMatrixRoads,
    timestamp: "2026-09-02T00:00:00.000Z",
    maxRoadFragments: 30,
  });

  assert.equal(prepared.diagnostics.algorithmVersion, STREET_ENGINE_ALGORITHM_VERSION);
  assert.equal(prepared.diagnostics.inputRoadCount, 11);
  assert.equal(prepared.diagnostics.eligibleRoadCount, 6);
  assert.equal(prepared.diagnostics.rejectedRoadCount, 3);
  assert.equal(prepared.diagnostics.invalidRoadCount, 1);
  assert.equal(prepared.diagnostics.duplicateFragmentCount, 1);
  assert.equal(prepared.diagnostics.fragmentCount, prepared.tasks.length);
  assert.equal(prepared.tasks.length, 9);
  assert.ok(prepared.diagnostics.durationMs >= 0);

  const sourceIds = new Set(prepared.tasks.flatMap((task) => task.source?.objectIds ?? []));
  assert.deepEqual(
    [...sourceIds].sort((first, second) => first - second),
    [100, 101, 102, 103, 108, 109],
  );
  assert.ok(prepared.tasks.every((task) =>
    task.id.startsWith("task_auto_")
    && task.areaPreparationGeneration === "generation-1"
    && task.status === "open"
    && task.geometry.coordinates.every((coordinate) =>
      pointInOrOnPolygon(coordinate, streetEngineMatrixArea)
    )
  ));

  const uStreet = prepared.tasks
    .filter((task) => task.source?.objectIds[0] === 101)
    .map((task) => task.geometry.coordinates)
    .sort((first, second) => first[0][0] - second[0][0]);
  assert.deepEqual(uStreet, [
    [[0, 7], [4, 7]],
    [[6, 7], [10, 7]],
  ]);

  const repeated = prepareStreetsForArea({
    campaignId: "campaign_engine",
    areaId: "area_u",
    area: streetEngineMatrixArea,
    generation: "generation-2",
    roads: [...streetEngineMatrixRoads].reverse(),
    timestamp: "2026-09-03T00:00:00.000Z",
    maxRoadFragments: 30,
  });
  assert.deepEqual(
    repeated.tasks.map((task) => task.id),
    prepared.tasks.map((task) => task.id),
  );
});

test("eligibility is explicit and rejects highways or access that are unsafe for preparation", () => {
  const cases = [
    ["residential", {}, true],
    ["service", {}, true],
    ["footway", {}, true],
    ["cycleway", {}, true],
    ["path", {}, true],
    ["motorway", {}, false],
    ["construction", {}, false],
    ["proposed", {}, false],
    ["abandoned", {}, false],
    ["residential", { access: "private" }, false],
    ["service", { foot: "no" }, false],
  ] as const;

  for (const [highway, extraTags, eligible] of cases) {
    assert.equal(
      streetRoadEligibility({ highway, ...extraTags }).eligible,
      eligible,
      highway,
    );
  }
  assert.equal(streetRoadEligibility({}).eligible, false);
});

test("fragment limits fail closed before a too-large prepared set is published", () => {
  assert.throws(
    () => prepareStreetsForArea({
      campaignId: "campaign_engine",
      areaId: "area_u",
      area: streetEngineMatrixArea,
      generation: "generation-1",
      roads: streetEngineMatrixRoads,
      timestamp: "2026-09-02T00:00:00.000Z",
      maxRoadFragments: 2,
    }),
    (error: unknown) => error instanceof StreetPreparationLimitError,
  );
});

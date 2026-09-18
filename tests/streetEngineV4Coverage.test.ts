import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { planStreetEngineV4Coverage } from '../src/domain/streetEngineV4Coverage.ts';

function contains(
  bbox: readonly [number, number, number, number],
  point: readonly [number, number],
) {
  return point[0] >= bbox[0] && point[0] <= bbox[2]
    && point[1] >= bbox[1] && point[1] <= bbox[3];
}

test('V4 coverage planner reserves enough bounded grid coverage for a post-release Gebiet 8 style expansion', () => {
  // Release #31/#32 pre-Gebiet-8 area union inferred from its 0.025° envelope.
  const previousAreaUnion = [
    [7.0129532, 50.7707203],
    [7.1107138, 50.8400218],
  ] as const;
  const plan = planStreetEngineV4Coverage(previousAreaUnion);

  assert.equal(plan.policy, 'grid-reserve-v1');
  assert.equal(plan.gridCellDegrees, 0.01);
  assert.equal(plan.reserveDegrees, 0.2);
  assert.ok(plan.cellCount <= 4096);

  // Real Gebiet 8 extrema from read-only Beta D1 evidence.
  assert.ok(contains(plan.bbox, [6.907691022915145, 50.896208323901874]));
  assert.ok(contains(plan.bbox, [7.0216924472821916, 50.9805567635199]));
});

test('V4 coverage planner snaps to the global shard grid and reduces reserve before exceeding the cell budget', () => {
  const plan = planStreetEngineV4Coverage([
    [6.90, 50.70],
    [7.35, 51.15],
  ]);
  assert.ok(plan.reserveDegrees < 0.2);
  assert.ok(plan.reserveDegrees >= 0);
  assert.ok(plan.cellCount <= 4096);
  for (const value of plan.bbox) {
    assert.ok(Math.abs(value * 100 - Math.round(value * 100)) < 1e-9);
  }
});

test('V4 coverage planner fails closed when even the current area union exceeds the source budget', () => {
  assert.throws(
    () => planStreetEngineV4Coverage([
      [6.0, 50.0],
      [7.0, 51.0],
    ]),
    /street_engine_v4_beta_coverage_too_large/u,
  );
});

test('Beta V4 release uses the tested grid-reserve planner and remains manually refreshable', async () => {
  const workflow = await readFile('.github/workflows/beta-release.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /scripts\/plan-street-engine-v4-coverage\.ts/u);
  assert.match(workflow, /V4_COVERAGE_POLICY/u);
  assert.match(workflow, /grid-reserve-v1/u);
  assert.doesNotMatch(workflow, /const margin=0\.025/u);
});

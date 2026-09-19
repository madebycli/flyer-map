import test from 'node:test';
import assert from 'node:assert/strict';
import type { DistributionTask, LineStringGeometry } from '../src/domain/campaign.ts';
import { RoadIndex, roadLength } from '../src/domain/streetNetwork.ts';

function networkTask(id: string, geometry: LineStringGeometry): DistributionTask {
  const length = roadLength(geometry);
  return {
    id,
    geometry,
    network: {
      fromNode: `${id}:from`,
      toNode: `${id}:to`,
      length,
      coverage: [],
    },
  } as unknown as DistributionTask;
}

test('RoadIndex preserves a tap in the middle of a street instead of pulling it to an endpoint', () => {
  const geometry: LineStringGeometry = {
    type: 'LineString',
    coordinates: [[7, 50], [7.01, 50]],
  };
  const task = networkTask('mid-road', geometry);
  const index = new RoadIndex([task]);
  const snap = index.candidates([7.004, 50], 10)[0];

  assert.ok(snap);
  assert.equal(snap.task.id, task.id);
  assert.ok(Math.abs(snap.point[0] - 7.004) < 1e-7);
  assert.ok(Math.abs(snap.point[1] - 50) < 1e-7);
  assert.ok(snap.measure > 1);
  assert.ok(snap.measure < task.network!.length - 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoadSnap } from '../src/domain/streetNetwork.ts';
import {
  SMART_POINT_AMBIGUITY_METERS,
  SMART_POINT_FALLBACK_RADIUS_METERS,
  smartPointCandidates,
} from '../src/domain/smartStreetPointSelection.ts';

function snap(id: string, distance: number): RoadSnap {
  return {
    task: { id },
    measure: 12,
    point: [7, 50],
    distance,
  } as unknown as RoadSnap;
}

test('rendered street hit ids constrain Smart Marking to the street actually under the pointer', () => {
  const result = smartPointCandidates([
    snap('near-main', 0.4),
    snap('tapped-side-street', 1.2),
    snap('other', 2),
  ], ['tapped-side-street']);
  assert.deepEqual(result.map((candidate) => candidate.task.id), ['tapped-side-street']);
});

test('crossing candidates may compete only while spatially near-equal', () => {
  const result = smartPointCandidates([
    snap('cross-a', 0.3),
    snap('cross-b', 0.8),
    snap('farther-short-route', SMART_POINT_AMBIGUITY_METERS + 0.31),
  ], []);
  assert.deepEqual(result.map((candidate) => candidate.task.id), ['cross-a', 'cross-b']);
});

test('fallback snap is bounded instead of considering roads across a broad radius', () => {
  const result = smartPointCandidates([
    snap('near', 2),
    snap('too-far', SMART_POINT_FALLBACK_RADIUS_METERS + 0.1),
  ], []);
  assert.deepEqual(result.map((candidate) => candidate.task.id), ['near']);
});

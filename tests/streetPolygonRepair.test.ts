import assert from 'node:assert/strict';
import test from 'node:test';
import { validateHousePolygonVertices } from '../src/domain/geometry.ts';
import { normalizeHousePolygon } from '../worker/streetNetwork/polygonRepair.ts';

const valid = [
  [7.1000, 50.7000],
  [7.1003, 50.7000],
  [7.1003, 50.7002],
  [7.1000, 50.7002],
  [7.1000, 50.7000],
] as [number, number][];

test('valid building polygon stays unchanged', () => {
  const result = normalizeHousePolygon(valid);
  assert.deepEqual(result, { type: 'Polygon', coordinates: [valid] });
});

test('duplicate adjacent building vertex is repaired without changing footprint bounds', () => {
  const malformed = [valid[0], valid[1], valid[1], valid[2], valid[3], valid[0]];
  const result = normalizeHousePolygon(malformed);
  assert.ok(result);
  assert.equal(result.coordinates.length, 1);
  assert.equal(validateHousePolygonVertices(result.coordinates[0].slice(0, -1)).valid, true);
  assert.equal(result.coordinates[0].length, 5);
});

test('A-B-A spike is removed conservatively', () => {
  const malformed = [
    valid[0],
    valid[1],
    [7.1004, 50.7001] as [number, number],
    valid[1],
    valid[2],
    valid[3],
    valid[0],
  ];
  const result = normalizeHousePolygon(malformed);
  assert.ok(result);
  assert.equal(validateHousePolygonVertices(result.coordinates[0].slice(0, -1)).valid, true);
});

test('irreparable degenerate footprint remains rejected', () => {
  const line = [
    [7.1, 50.7],
    [7.2, 50.7],
    [7.3, 50.7],
    [7.1, 50.7],
  ] as [number, number][];
  assert.equal(normalizeHousePolygon(line), null);
});

test('open rings are not silently invented by the repair helper', () => {
  assert.equal(normalizeHousePolygon(valid.slice(0, -1)), null);
});

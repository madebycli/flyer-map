import test from 'node:test';
import assert from 'node:assert/strict';
import { areaSquareMeters, fromRing, insertVertex, isSamePolygon, midpoints, moveVertex, removeVertex, seedSquare, toRing, validate, MAX_VERTICES } from '../src/v5/areas/polygon.ts';

const square = seedSquare([13, 51], 100);

test('ring <-> vertices round trip keeps the closing point out of the edit list', () => {
  const ring = toRing(square);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.deepEqual(fromRing(ring), square);
  assert.deepEqual(fromRing(square), square, 'an already open list stays as it is');
});

test('every edge offers a midpoint handle; inserting yields the new index', () => {
  const mids = midpoints(square);
  assert.equal(mids.length, 4);
  const inserted = insertVertex(square, 1, mids[1].point)!;
  assert.equal(inserted.vertices.length, 5);
  assert.equal(inserted.index, 2);
  assert.deepEqual(inserted.vertices[2], mids[1].point);
  const wrap = insertVertex(square, 3, mids[3].point)!;
  assert.equal(wrap.index, 4, 'the closing edge inserts at the end');
});

test('moving and removing keep the polygon valid, and refuse to go below a triangle', () => {
  assert.equal(validate(square).valid, true);
  const moved = moveVertex(square, 2, [13.01, 51.01]);
  assert.equal(validate(moved).valid, true);
  assert.deepEqual(moved[2], [13.01, 51.01]);
  assert.equal(removeVertex(square, 0)!.length, 3);
  assert.equal(removeVertex(removeVertex(square, 0)!, 0), null);
});

test('self-crossing and tiny polygons are rejected with a reason', () => {
  const at = (x: number, y: number): [number, number] => [13 + x * 1e-5, 51 + y * 1e-5];
  const crossing = validate([at(0, 0), at(300, 200), at(300, 0), at(0, 300)]); // edges AB and CD cross, net area is not zero
  assert.equal(crossing.valid, false);
  assert.match((crossing as { reason: string }).reason, /kreuzen/);
  assert.equal(validate(seedSquare([13, 51], 0.01)).valid, false);
});

test('the vertex limit of Areas is enforced on insert', () => {
  let v = square;
  for (let i = 0; i < MAX_VERTICES + 5; i++) { const r = insertVertex(v, 0, [13 + i * 1e-6, 51]); if (!r) break; v = r.vertices; }
  assert.equal(v.length, MAX_VERTICES);
  assert.equal(insertVertex(v, 0, [13, 51]), null);
});

test('area size is plausible and polygons compare by value', () => {
  assert.ok(Math.abs(areaSquareMeters(seedSquare([13, 51], 100)) - 200 * 200) < 400, 'a 200 m square is ~40 000 m²');
  assert.equal(isSamePolygon(square, square.map((p) => [...p] as [number, number])), true);
  assert.equal(isSamePolygon(square, moveVertex(square, 0, [0, 0])), false);
});

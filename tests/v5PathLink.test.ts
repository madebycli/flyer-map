import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNetwork } from '../src/v5/engine/index.ts';
import { slimNetwork } from '../src/v5/engine/slim.ts';
import { buildIndex, keysForSegments } from '../src/v5/app/mark.ts';
import { houseKey, segmentKey } from '../src/v5/store/types.ts';
import { pathLinkRaw } from './helpers/pathLinkCity.ts';

test('houses on a garden path are taken along when the street their address names is marked; paths are never marked for their own sake', () => {
  const raw = pathLinkRaw;
  const net = slimNetwork(deriveNetwork(raw));
  const byId = new Map(net.houses.map((h) => [h.id, h]));
  const h101 = byId.get('h101')!, h102 = byId.get('h102')!, h103 = byId.get('h103')!, h104 = byId.get('h104')!;
  const wayOf = (id: string | null) => net.segments.find((s) => s.id === id)!.wayId;
  assert.equal(wayOf(h101.parent), 2, 'the house stays physically on its path (150 m from the street, beyond the 80 m reach of the address rule)');
  assert.equal(wayOf(h101.streetParent), 1, 'but it is linked to the street its address names');
  assert.equal(h104.streetParent, null, 'a house whose address names a street that is not there is not linked');
  assert.equal(net.diagnostics.linkedFromPaths, 3);

  const index = buildIndex(net);
  const keys = new Set(keysForSegments(index, [h101.streetParent!], true));
  assert.ok(keys.has(houseKey('h101')) && keys.has(houseKey('h102')), 'marking that street piece takes both path houses along');
  assert.ok(keys.has(segmentKey(h101.parent!)) && keys.has(segmentKey(h102.parent!)), 'and the path pieces that carry exactly those houses');
  assert.ok(!keys.has(houseKey('h103')) && !keys.has(houseKey('h104')), 'houses of other path pieces stay open');
  const pathKeys = [...keys].filter((k) => k.startsWith('s:') && wayOf(k.slice(2)) !== 1);
  assert.equal(pathKeys.length, new Set([h101.parent, h102.parent]).size, 'no other path piece is marked (not path B, C or D)');
  // without "+ Häuser" nothing of this comes along
  const bare = new Set(keysForSegments(index, [h101.streetParent!], false));
  assert.ok(!bare.has(houseKey('h101')));
});

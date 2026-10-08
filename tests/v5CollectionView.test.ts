import test from 'node:test';
import assert from 'node:assert/strict';
import { actionErrorText, areaPercent, areaView } from '../src/v5/app/collection.ts';
import type { Meta } from '../src/v5/app/api.ts';

const area = (status: Meta['areas'][number]['collection'] extends infer C ? NonNullable<C>['status'] : never, runId: string | null, claimedById: string | null = null) =>
  ({ id: 'a', name: 'A', teamId: '', geometry: { type: 'Polygon', coordinates: [] }, updatedAt: '', packVersion: 1, writable: false, collection: { status, runId, claimedBy: null, claimedById } }) as unknown as Meta['areas'][number];
const runs = [{ id: 'r1', mainAreaId: 'm', members: [{ collectorId: 'c1', label: 'Anna' }, { collectorId: 'c2', label: 'Ben' }] }];
const anna = { collectorId: 'c1', label: 'Anna' }, ben = { collectorId: 'c2', label: 'Ben' }, cleo = { collectorId: 'c3', label: 'Cleo' };

test('an open Area can be taken; a taken one offers joining, never a second Room', () => {
  assert.equal(areaView(area('open', null), runs, anna).canClaim, true);
  assert.equal(areaView(area('open', null), runs, null).canClaim, false, 'admins/viewers cannot claim');
  const taken = areaView(area('in-progress', 'r1', 'c1'), runs, cleo);
  assert.deepEqual([taken.phase, taken.canClaim, taken.canJoin, taken.canLeave, taken.members], ['working', false, true, false, ['Anna', 'Ben']]);
});

test('roles inside a Room: holder may release, any member may complete or leave, outsiders may only join', () => {
  const a = area('in-progress', 'r1', 'c1');
  const holder = areaView(a, runs, anna), member = areaView(a, runs, ben), outsider = areaView(a, runs, cleo);
  assert.deepEqual([holder.canRelease, holder.canComplete, holder.canLeave, holder.mine], [true, true, true, true]);
  assert.deepEqual([member.canRelease, member.canComplete, member.canLeave, member.mine, member.inRoom], [false, true, true, false, true]);
  assert.deepEqual([outsider.canRelease, outsider.canComplete, outsider.canLeave, outsider.canJoin], [false, false, false, true]);
});

test('finished and archived Areas offer nothing', () => {
  for (const status of ['completed', 'archived'] as const) {
    const v = areaView(area(status, 'r1', 'c1'), runs, anna);
    assert.equal(v.phase, 'done');
    assert.deepEqual([v.canClaim, v.canJoin, v.canLeave, v.canRelease, v.canComplete], [false, false, false, false, false]);
  }
});

test('an Area whose Run is gone falls back to open instead of offering actions on a ghost Room', () => {
  const v = areaView(area('claimed', 'ghost', 'c1'), runs, anna);
  assert.equal(v.phase, 'open');
  assert.equal(v.canClaim, false, 'status is not open on the server, so nobody can claim it yet');
});

test('percent: partial progress never reads 100, a finished Area always does, no houses means no number', () => {
  assert.equal(areaPercent(999, 1000, 'working'), 99);
  assert.equal(areaPercent(1000, 1000, 'working'), 99, 'all houses done but not declared finished');
  assert.equal(areaPercent(3, 1000, 'done'), 100);
  assert.equal(areaPercent(0, 0, 'open'), null);
  assert.equal(areaPercent(1, 3, 'open'), 33);
});

test('error texts are human, never raw codes', () => {
  assert.match(actionErrorText({ code: 'collection_area_unavailable' }), /verändert/);
  assert.match(actionErrorText({ code: 'collection_run_member_required' }), /nicht \(mehr\) im Arbeitsraum/);
  assert.match(actionErrorText(new Error('boom')), /erneut versuchen/);
});

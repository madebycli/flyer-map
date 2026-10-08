import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign, NOW, setup, stamp } from './helpers/v5Setup.ts';

const url = `/api/v5/campaigns/${campaign}/notes`;
type Pull = { notes: { id: string; key: string; area: string; flag: string | null; text: string; rev: string; deleted: boolean; by: string }[]; cursor: number; more: boolean };
const note = (id: string, key = 'h:a', extra: Record<string, unknown> = {}) => ({ id, key, area: 'area_n', flag: null, text: 'hallo', rev: id, deleted: false, ...extra });
const push = (call: Awaited<ReturnType<typeof setup>>['call'], who: string, ...notes: unknown[]) => call(who, 'POST', url, { notes });
const pull = async (call: Awaited<ReturnType<typeof setup>>['call'], who: string, since = 0) => (await (await call(who, 'GET', `${url}?since=${since}`)).json()) as Pull;

test('a note is stored, pulled incrementally by everyone allowed to see it, and keeps its author', async () => {
  const { call } = await setup();
  const id = stamp(NOW - 5000);
  const res = await (await push(call, 'editor', note(id, 'h:a', { flag: 'dog', text: '  Vorsicht  Hund  ' }))).json() as { accepted: string[]; rejected: unknown[] };
  assert.deepEqual(res.accepted, [id]);
  const seen = await pull(call, 'viewer');
  assert.equal(seen.notes.length, 1);
  assert.deepEqual([seen.notes[0].flag, seen.notes[0].text, seen.notes[0].by], ['dog', 'Vorsicht  Hund', 'editor']);
  assert.equal((await pull(call, 'viewer', seen.cursor)).notes.length, 0, 'cursor is exclusive');
  // an admin edit does not steal authorship
  await push(call, 'admin', note(id, 'h:a', { flag: 'danger', text: 'Hund weg', rev: stamp(NOW - 4000) }));
  const after = await pull(call, 'viewer', seen.cursor);
  assert.deepEqual([after.notes[0].flag, after.notes[0].text, after.notes[0].by], ['danger', 'Hund weg', 'editor']);
});

test('concurrent edits: the newer revision wins whatever the arrival order; replays are harmless', async () => {
  const { call } = await setup();
  const id = stamp(NOW - 9000);
  const older = note(id, 'h:a', { text: 'alt', rev: stamp(NOW - 5000) });
  const newer = note(id, 'h:a', { text: 'neu', rev: stamp(NOW - 4000, 0, 'z') });
  await push(call, 'editor', newer);
  const late = await (await push(call, 'admin', older)).json() as { accepted: string[] };
  assert.deepEqual(late.accepted, [id], 'a stale edit is accepted (idempotent) but does not win');
  assert.equal((await pull(call, 'admin')).notes[0].text, 'neu', 'the stale edit did not overwrite');
  await push(call, 'editor', newer, newer);
  const state = await pull(call, 'admin');
  assert.equal(state.notes.length, 1);
  assert.equal(state.notes[0].text, 'neu');
});

test('deleting is a tombstone that a later edit can revive and an older edit cannot', async () => {
  const { call } = await setup();
  const id = stamp(NOW - 9000);
  await push(call, 'editor', note(id));
  await push(call, 'editor', note(id, 'h:a', { deleted: true, rev: stamp(NOW - 5000) }));
  await push(call, 'admin', note(id, 'h:a', { text: 'zu spät', rev: stamp(NOW - 6000) }));
  assert.equal((await pull(call, 'admin')).notes[0].deleted, true);
  await push(call, 'admin', note(id, 'h:a', { text: 'zurück', rev: stamp(NOW - 4000) }));
  const final = (await pull(call, 'admin')).notes[0];
  assert.deepEqual([final.deleted, final.text], [false, 'zurück']);
});

test('validation: bad ids, keys, flags, empty notes, future clocks, area/key mismatch are refused per note', async () => {
  const { call } = await setup();
  const ok = stamp(NOW - 1000);
  const res = await (await push(call, 'admin',
    note(ok),
    note('nonsense'),
    note(stamp(NOW - 900), 'x:bad'),
    note(stamp(NOW - 800), 'h:a', { flag: 'party' }),
    note(stamp(NOW - 700), 'h:a', { text: '   ', flag: null }),
    note(stamp(NOW + 3 * 86_400_000), 'h:a'),
    note(stamp(NOW - 600), 'a:somewhere_else'),
    note(stamp(NOW - 500), 'h:a', { rev: stamp(NOW - 600) }),
  )).json() as { accepted: string[]; rejected: { id: string; reason: string }[] };
  assert.deepEqual(res.accepted, [ok]);
  assert.deepEqual(res.rejected.map((r) => r.reason), ['bad_id', 'bad_key', 'bad_flag', 'empty', 'clock_future', 'bad_key', 'bad_id']);
  assert.equal((await pull(call, 'admin')).notes.length, 1);
  assert.equal((await call('admin', 'POST', url, { notes: [] })).status, 400);
  assert.equal((await call('admin', 'POST', url, { notes: Array.from({ length: 51 }, (_, i) => note(stamp(NOW - 5000, i))) })).status, 400);
});

test('control characters are stripped and overlong text is cut, never rejected silently', async () => {
  const { call } = await setup();
  await push(call, 'admin', note(stamp(NOW - 1000), 'h:a', { text: `\u0000ab\u0007c${'x'.repeat(900)}` }));
  const text = (await pull(call, 'admin')).notes[0].text;
  assert.ok(text.startsWith('abcx') && text.length === 500);
});

test('roles: viewers read but never write; scoped editors only see and write their own Area', async () => {
  const { call } = await setup();
  assert.equal((await push(call, 'viewer', note(stamp(NOW - 3000)))).status, 403);
  assert.equal((await call(null, 'GET', url)).status, 401);
  const own = stamp(NOW - 2000), foreign = stamp(NOW - 1900);
  const res = await (await push(call, 'editor', note(own), note(foreign, 'h:z', { area: 'area_o' }))).json() as { accepted: string[]; rejected: { reason: string }[] };
  assert.deepEqual(res.accepted, [own]);
  assert.deepEqual(res.rejected.map((r) => r.reason), ['area_forbidden']);
  await push(call, 'other', note(stamp(NOW - 1800), 'h:q', { area: 'area_o', text: 'andere' }));
  assert.deepEqual((await pull(call, 'editor')).notes.map((n) => n.text), ['hallo'], 'editor does not see the other team’s notes');
  assert.equal((await pull(call, 'admin')).notes.length, 2);
});

test('a note never moves to another key or Area, not even by a writer of both', async () => {
  const { call } = await setup();
  const id = stamp(NOW - 3000);
  await push(call, 'admin', note(id, 'h:a'));
  const moved = await (await push(call, 'admin', note(id, 'h:b', { rev: stamp(NOW - 2000) }))).json() as { rejected: { reason: string }[] };
  assert.deepEqual(moved.rejected.map((r) => r.reason), ['note_immutable']);
  const elsewhere = await (await push(call, 'admin', note(id, 'h:a', { area: 'area_o', rev: stamp(NOW - 1500) }))).json() as { rejected: { reason: string }[] };
  assert.deepEqual(elsewhere.rejected.map((r) => r.reason), ['note_immutable']);
  const n = (await pull(call, 'admin')).notes[0];
  assert.deepEqual([n.key, n.area, n.text], ['h:a', 'area_n', 'hallo']);
});

test('area notes use the a:<area> key and sequence numbers never repeat under interleaved writers', async () => {
  const { call } = await setup();
  const calls = await Promise.all(Array.from({ length: 12 }, (_, i) => push(call, i % 2 ? 'admin' : 'editor', note(stamp(NOW - 9000, i, `w${i}`), i < 3 ? 'a:area_n' : `h:${i}`))));
  assert.ok(calls.every((r) => r.status === 200));
  const all = await pull(call, 'admin');
  assert.equal(all.notes.length, 12);
  let cursor = 0; const seen = new Set<string>();
  for (let guard = 0; guard < 20; guard++) {
    const page = await (await call('admin', 'GET', `${url}?since=${cursor}&limit=5`)).json() as Pull;
    for (const n of page.notes) { assert.ok(!seen.has(n.id), 'no note twice'); seen.add(n.id); }
    cursor = page.cursor;
    if (!page.more) break;
  }
  assert.equal(seen.size, 12, 'paging reaches every note exactly once');
});

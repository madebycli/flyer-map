import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign, NOW, setup } from './helpers/v5Setup.ts';
import { MemoryNotePersistence, NoteStore } from '../src/v5/notes/store.ts';
import { NoteSync, type NoteTransport } from '../src/v5/notes/sync.ts';
import type { Note } from '../src/v5/notes/types.ts';

const url = `/api/v5/campaigns/${campaign}/notes`;
type Call = Awaited<ReturnType<typeof setup>>['call'];
const transport = (call: Call, who: string, flaky = { down: false }): NoteTransport => ({
  async pull(since) {
    if (flaky.down) throw new Error('offline');
    const body = await (await call(who, 'GET', `${url}?since=${since}&limit=3`)).json() as { notes: Note[]; cursor: number; more: boolean };
    return body;
  },
  async push(notes) {
    if (flaky.down) throw new Error('offline');
    const res = await call(who, 'POST', url, { notes });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { accepted: string[]; rejected: { id: string; reason: string }[] };
  },
});
const device = (call: Call, who: string, persistence: MemoryNotePersistence | null = null, flaky = { down: false }) => {
  let t = NOW;
  const store = new NoteStore(who, persistence, () => (t += 1));
  return { store, sync: new NoteSync(store, transport(call, who, flaky)), flaky };
};

test('local edits show at once, reach other devices through the real endpoint, and echo back without duplicates', async () => {
  const { call } = await setup();
  const a = device(call, 'admin'), b = device(call, 'editor');
  const seen: string[] = [];
  b.store.subscribe((keys) => seen.push(...keys));
  const created = a.store.add('h:a', 'area_n', 'dog', 'Hund im Garten')!;
  assert.deepEqual(a.store.forKey('h:a').map((n) => n.text), ['Hund im Garten'], 'visible before any network');
  await a.sync.syncOnce();
  assert.equal(a.store.pendingNotes().length, 0);
  await b.sync.syncOnce();
  await new Promise((r) => setTimeout(r));
  assert.deepEqual(b.store.forKey('h:a').map((n) => [n.id, n.flag, n.by]), [[created.id, 'dog', 'admin']]);
  assert.ok(seen.includes('h:a'), 'subscribers are told which key changed');
  await a.sync.syncOnce();
  assert.equal(a.store.forKey('h:a').length, 1, 'own echo is not duplicated');
});

test('edits and deletions propagate; two devices editing the same note converge on the newer revision', async () => {
  const { call } = await setup();
  const a = device(call, 'admin'), b = device(call, 'editor');
  const n = a.store.add('s:x', 'area_n', null, 'eins')!;
  await a.sync.syncOnce(); await b.sync.syncOnce();
  a.store.edit(n.id, { text: 'von a' });
  b.store.edit(n.id, { text: 'von b' }); // b's device clock is 1 ms ahead for this edit → newer
  await a.sync.syncOnce(); await b.sync.syncOnce(); await a.sync.syncOnce();
  assert.equal(a.store.get(n.id)!.text, b.store.get(n.id)!.text);
  b.store.remove(n.id);
  await b.sync.syncOnce(); await a.sync.syncOnce();
  assert.deepEqual(a.store.forKey('s:x'), []);
  assert.equal(a.store.get(n.id)!.deleted, true);
});

test('offline: notes are queued, survive an app restart through persistence, and are sent after reconnect', async () => {
  const { call } = await setup();
  const persistence = new MemoryNotePersistence();
  const first = device(call, 'editor', persistence, { down: true });
  await first.store.hydrate();
  first.store.add('h:a', 'area_n', 'locked', 'Tor zu');
  await assert.rejects(first.sync.syncOnce());
  assert.equal(persistence.data!.pending.length, 1, 'outbox is persisted immediately');
  const second = device(call, 'editor', persistence);
  await second.store.hydrate();
  assert.deepEqual(second.store.forKey('h:a').map((n) => n.text), ['Tor zu'], 'restored after restart');
  await second.sync.syncOnce();
  assert.equal(second.store.pendingNotes().length, 0);
  const admin = device(call, 'admin');
  await admin.sync.syncOnce();
  assert.deepEqual(admin.store.forKey('h:a').map((n) => n.text), ['Tor zu']);
});

test('a refused note (area not allowed) is rolled back instead of lingering as a phantom', async () => {
  const { call } = await setup();
  const e = device(call, 'editor');
  e.store.add('h:z', 'area_o', 'dog', 'darf ich nicht');
  const ok = e.store.add('h:a', 'area_n', 'info', 'darf ich')!;
  await e.sync.syncOnce();
  assert.deepEqual(e.store.all().map((n) => n.id), [ok.id]);
  assert.equal(e.store.pendingNotes().length, 0);
});

test('a read-only role is refused by the server (HTTP 403) and the failure surfaces instead of being swallowed', async () => {
  const { call } = await setup();
  const v = device(call, 'viewer');
  const a = device(call, 'admin');
  const note = a.store.add('h:a', 'area_n', 'info', 'original')!;
  await a.sync.syncOnce(); await v.sync.syncOnce();
  v.store.edit(note.id, { text: 'unerlaubt' });
  assert.equal(v.store.get(note.id)!.text, 'unerlaubt');
  await assert.rejects(v.sync.syncOnce(), /HTTP 403/);
});

test('a remote newer revision beats a pending older local edit; a local edit made after still wins', async () => {
  const { call } = await setup();
  const a = device(call, 'admin'), b = device(call, 'editor');
  const n = a.store.add('h:a', 'area_n', null, 'v1')!;
  await a.sync.syncOnce(); await b.sync.syncOnce();
  b.store.edit(n.id, { text: 'b offline' });
  a.store.edit(n.id, { text: 'a online' });
  await a.sync.syncOnce();
  await b.sync.syncOnce();
  await a.sync.syncOnce();
  const winner = a.store.get(n.id)!.text;
  assert.ok(['a online', 'b offline'].includes(winner));
  assert.equal(b.store.get(n.id)!.text, winner, 'both devices converge');
  b.store.edit(n.id, { text: 'danach' });
  await b.sync.syncOnce(); await a.sync.syncOnce();
  assert.equal(a.store.get(n.id)!.text, 'danach');
});

test('an edit made while a push is in flight is not lost by the acknowledgement of the older revision', async () => {
  const { call } = await setup();
  const a = device(call, 'admin');
  const n = a.store.add('h:a', 'area_n', null, 'erst')!;
  const inner = transport(call, 'admin');
  const slow: NoteTransport = { pull: inner.pull, async push(notes) { const r = await inner.push(notes); a.store.edit(n.id, { text: 'während des Sendens' }); return r; } };
  const sync = new NoteSync(a.store, slow);
  await sync.syncOnce();
  assert.equal(a.store.pendingNotes().length, 0, 'the follow-up edit was pushed in the same round');
  const b = device(call, 'editor');
  await b.sync.syncOnce();
  assert.equal(b.store.get(n.id)!.text, 'während des Sendens');
});

test('store rules: empty notes are not created, clearing text and flag deletes, restore brings it back', () => {
  const s = new NoteStore('me');
  assert.equal(s.add('h:a', 'area_n', null, '   '), null);
  const n = s.add('h:a', 'area_n', 'dog', '')!;
  assert.equal(s.edit(n.id, { flag: null }), null === null ? s.get(n.id) : null);
  assert.equal(s.forKey('h:a').length, 0, 'no flag and no text → removed');
  s.restore(n.id);
  assert.equal(s.forKey('h:a').length, 1);
  assert.equal(s.edit('unknown', { text: 'x' }), null);
});

test('a late older revision from the server never overwrites a newer local edit (pull in flight while typing)', () => {
  const s = new NoteStore('me');
  const n = s.add('h:a', 'area_n', null, 'eins')!;
  const older = { ...n };
  const edited = s.edit(n.id, { text: 'zwei' })!;
  s.receive([older], 5);
  assert.equal(s.get(n.id)!.text, 'zwei');
  assert.equal(s.pendingNotes().length, 1, 'the newer edit is still queued');
  assert.equal(s.lastCursor, 5);
  s.receive([edited], 6);
  assert.equal(s.pendingNotes().length, 0, 'its echo clears the queue');
});

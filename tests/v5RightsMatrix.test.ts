import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, campaign, NOW, stamp } from './helpers/v5Setup.ts';

// Role × route × Gebiet, judged against the policy (not against whatever the handlers happen to return):
//   anon: nothing. viewer: read everything, write nothing. admin: everything.
//   team-editor: read and write only the Areas of the own team; no bulk delete, no clean-up.
//   Abhol-Helfer (collection-collector) are covered in v5Collection.test.ts, which needs the Run/Area fixture.
const base = `/api/v5/campaigns/${campaign}`;
type Who = 'viewer' | 'admin' | 'editor' | 'other';
const WHO: Who[] = ['viewer', 'admin', 'editor', 'other'];
const own: Record<Who, string[]> = { viewer: ['area_n', 'area_o'], admin: ['area_n', 'area_o'], editor: ['area_n'], other: ['area_o'] };
const writable: Record<Who, string[]> = { viewer: [], admin: ['area_n', 'area_o'], editor: ['area_n'], other: ['area_o'] };
let seq = 0;
const op = (area: string) => ({ ops: [{ id: stamp(NOW - 1000 + seq++), key: `h:${area}`, status: 'completed', area }] });
const note = (area: string) => { const id = stamp(NOW - 1000 + seq++); return { notes: [{ id, key: `a:${area}`, area, flag: 'dog', text: 'x', rev: id }] }; };

test('anonymous callers get 401 on every route', async () => {
  const { call } = await setup();
  const routes: [string, string, unknown?][] = [
    ['GET', `${base}/meta`], ['GET', `${base}/state?since=0`], ['POST', `${base}/ops`, op('area_n')], ['GET', `${base}/notes?since=0`], ['POST', `${base}/notes`, note('area_n')],
    ['GET', `${base}/areas/area_n/pack`], ['POST', `${base}/areas/area_n/pack`], ['POST', `${base}/areas/area_n/prune`, { keys: ['h:a'] }], ['POST', `${base}/areas/area_n/forget`],
  ];
  for (const [method, path, body] of routes) assert.equal((await call(null, method, path, body)).status, 401, `${method} ${path}`);
});

for (const who of WHO) {
  test(`${who}: writes only where the policy allows, in ops and notes`, async () => {
    const { call } = await setup();
    for (const area of ['area_n', 'area_o']) {
      const may = writable[who].includes(area);
      const ops = await call(who, 'POST', `${base}/ops`, op(area));
      const notes = await call(who, 'POST', `${base}/notes`, note(area));
      if (who === 'viewer') { assert.equal(ops.status, 403, `ops ${area}`); assert.equal(notes.status, 403, `notes ${area}`); continue; }
      for (const [name, res] of [['ops', ops], ['notes', notes]] as const) {
        assert.equal(res.status, 200, `${name} ${area}`);
        const out = await res.json() as { accepted: string[]; rejected: { reason: string }[] };
        assert.equal(out.accepted.length, may ? 1 : 0, `${name} ${area} accepted`);
        if (!may) assert.deepEqual(out.rejected.map((r) => r.reason), ['area_forbidden'], `${name} ${area} reason`);
      }
    }
  });

  test(`${who}: reads only the Areas it may see`, async () => {
    const { call } = await setup();
    // admin writes into both Areas first
    await call('admin', 'POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 900), key: 'h:in_n', status: 'completed', area: 'area_n' }, { id: stamp(NOW - 899), key: 'h:in_o', status: 'completed', area: 'area_o' }] });
    const n = note('area_n'), o = note('area_o');
    await call('admin', 'POST', `${base}/notes`, { notes: [...n.notes, ...o.notes] });
    const state = await (await call(who, 'GET', `${base}/state?since=0`)).json() as { ops: { area: string }[] };
    const notes = await (await call(who, 'GET', `${base}/notes?since=0`)).json() as { notes: { area: string }[] };
    assert.deepEqual([...new Set(state.ops.map((o) => o.area))].sort(), own[who], 'state');
    assert.deepEqual([...new Set(notes.notes.map((o) => o.area))].sort(), own[who], 'notes');
    const meta = await (await call(who, 'GET', `${base}/meta`)).json() as { areas: { id: string; writable: boolean }[] };
    assert.deepEqual(meta.areas.map((a) => a.id).sort(), own[who], 'meta areas');
    for (const a of meta.areas) assert.equal(a.writable, writable[who].includes(a.id), `meta writable ${a.id}`);
  });

  test(`${who}: bulk clean-up and pack builds are admin-only or team-bound`, async () => {
    const { call } = await setup();
    const none = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const prune = (await call(who, 'POST', `${base}/areas/area_n/prune`, { keys: ['h:a'] })).status;
    const forget = (await call(who, 'POST', `${base}/areas/area_gone/forget`)).status;
    assert.equal(prune, who === 'admin' ? 200 : 403, 'prune');
    assert.equal(forget, who === 'admin' ? 200 : 403, 'forget');
    for (const area of ['area_n', 'area_o']) {
      const res = (await call(who, 'POST', `${base}/areas/${area}/pack`, undefined, { fetchImpl: none })).status;
      const readable = own[who].includes(area), may = writable[who].includes(area);
      // a caller may only reach the build step (an upstream failure answers 502) in an Area it may write; others are refused before any upstream request
      if (may) assert.equal(res, 502, `build ${area} reaches upstream`);
      else assert.ok(res === 403 || res === 404, `build ${area} refused (${res})`);
      void readable;
    }
  });
}

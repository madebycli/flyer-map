// Independent follow-up checks. Run against the exact checkout under review:
// REVIEW_ROOT=/path/to/checkout node --experimental-transform-types scripts/v5-e2e/review-fixes.mjs
// Exit 1 means a required property failed. This is not a defect-asserting green test.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.REVIEW_ROOT ?? process.cwd());
const mod = (p) => import(pathToFileURL(resolve(root, p)).href);
const { setup, campaign, NOW, stamp } = await mod('tests/helpers/v5Setup.ts');
const { FieldStore } = await mod('src/v5/store/store.ts');
const { handleV5Api } = await mod('worker/v5/api.ts');
const base = `/api/v5/campaigns/${campaign}`;
let failed = 0;
async function check(label, fn) {
  try { await fn(); console.log(`PASS ${label}`); }
  catch (e) { failed++; console.error(`FAIL ${label}: ${e.message}`); }
}
const put = (call, key, wall, status = 'completed', counter = 0) => call('admin', 'POST', `${base}/ops`, { ops: [{ id: stamp(wall, counter), key, status, area: 'area_n' }] });
const pull = async (call, cursor = 0, limit = 1000) => (await call('viewer', 'GET', `${base}/state?since=${cursor}&limit=${limit}`)).json();

await check('B-F-002 normal prune and forget converge in real FieldStores', async () => {
  for (const action of ['prune', 'forget']) {
    const { call, db } = await setup();
    await put(call, 'h:stale', NOW - 100);
    const peer = new FieldStore('peer', null, () => NOW);
    const first = await pull(call); peer.receive(first.ops, first.cursor);
    assert.equal(peer.statusOf('h:stale'), 'completed');
    if (action === 'forget') db.sqlite.prepare("DELETE FROM areas WHERE id='area_n'").run();
    const cleared = await call('admin', 'POST', `${base}/areas/area_n/${action}`, action === 'prune' ? { keys: ['h:stale'] } : undefined);
    assert.equal(cleared.status, 200);
    assert.equal((await cleared.json()).removed, 1);
    const second = await pull(call, peer.lastCursor); peer.receive(second.ops, second.cursor);
    assert.equal(peer.statusOf('h:stale'), 'open', action);
    const full = await pull(call); peer.receive(full.ops, full.cursor);
    assert.equal(peer.statusOf('h:stale'), 'open', `${action} full pull`);
  }
});

await check('B-F-003 null shapes return structured rejection', async () => {
  const { db, cookies } = await setup();
  for (const [suffix, body, expected] of [['ops', 'null', 400], ['notes', 'null', 400], ['areas/area_n/prune', 'null', 400], ['ops', '{"ops":[null]}', 200], ['notes', '{"notes":[null]}', 200]]) {
    const r = await handleV5Api(new Request(`https://example.test${base}/${suffix}`, { method: 'POST', headers: { cookie: cookies.admin, 'content-type': 'application/json' }, body }), db, { now: () => NOW });
    assert.equal(r.status, expected, suffix);
    if (expected === 200) { const out = await r.json(); assert.equal(out.accepted.length, 0); assert.equal(out.rejected.length, 1); }
  }
});

await check('B-F-004 recreate preserves new status', async () => {
  const { call, db } = await setup();
  await put(call, 'h:old', NOW - 100);
  const row = db.sqlite.prepare("SELECT * FROM areas WHERE id='area_n'").get();
  db.sqlite.prepare("DELETE FROM areas WHERE id='area_n'").run();
  const original = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (!injected) {
      injected = true;
      db.sqlite.prepare('INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(row.id, row.campaign_id, row.team_id, 'Recreated', row.geometry_json, row.created_at, row.updated_at);
      db.sqlite.prepare("UPDATE v5_state SET op_id=?, status='later' WHERE key='h:old'").run(stamp(NOW - 50));
    }
    return original(statements);
  };
  const result = await call('admin', 'POST', `${base}/areas/area_n/forget`);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).removed, 0);
  assert.equal(db.sqlite.prepare("SELECT status FROM v5_state WHERE key='h:old'").get().status, 'later');
});

await check('pagination has no skipped tombstones across chunks', async () => {
  const { call } = await setup();
  const keys = Array.from({ length: 1005 }, (_, i) => `h:p${i}`);
  for (let start = 0; start < keys.length; start += 100) {
    await call('admin', 'POST', `${base}/ops`, { ops: keys.slice(start, start + 100).map((key, i) => ({ id: stamp(NOW - 100, start + i), key, status: 'completed', area: 'area_n' })) });
  }
  let cursor = 0, first;
  do { first = await pull(call, cursor); cursor = first.cursor; } while (first.more);
  const r = await call('admin', 'POST', `${base}/areas/area_n/prune`, { keys, confirm: true });
  assert.equal((await r.json()).removed, keys.length);
  const seen = new Set(); let page;
  do {
    page = await pull(call, cursor, 37);
    assert.ok(page.cursor >= cursor); cursor = page.cursor;
    for (const op of page.ops) { assert.equal(op.status, 'open'); assert.ok(!seen.has(op.key)); seen.add(op.key); }
  } while (page.more);
  assert.equal(seen.size, keys.length);
});

await check('B-F-002 boundary: zzzz counter still clears peers', async () => {
  const { call } = await setup();
  const accepted = await (await put(call, 'h:boundary', NOW, 'completed', 36 ** 4 - 1)).json();
  assert.equal(accepted.accepted.length, 1, 'a valid four-digit maximum counter is accepted');
  const peer = new FieldStore('peer', null, () => NOW);
  const first = await pull(call); peer.receive(first.ops, first.cursor);
  await call('admin', 'POST', `${base}/areas/area_n/prune`, { keys: ['h:boundary'] });
  const next = await pull(call, peer.lastCursor); peer.receive(next.ops, next.cursor);
  assert.equal(peer.statusOf('h:boundary'), 'open', `old=${first.ops[0].id}, clear=${next.ops[0]?.id}`);
});

await check('B-F-006 per-key concurrent edit survives global maximum guard', async () => {
  const { call, db } = await setup();
  await put(call, 'h:low', NOW - 5000);
  await put(call, 'h:high', NOW - 1000);
  const original = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (!injected) {
      injected = true;
      // Simulates a valid, newer per-key update arriving between candidate lookup and cleanup batch.
      const incoming = await (await put(call, 'h:low', NOW - 3000, 'later')).json();
      assert.equal(incoming.accepted.length, 1);
    }
    return original(statements);
  };
  await call('admin', 'POST', `${base}/areas/area_n/prune`, { keys: ['h:low', 'h:high'] });
  assert.equal(db.sqlite.prepare("SELECT status FROM v5_state WHERE key='h:low'").get().status, 'later');
});

console.log(`${failed} required properties failed on ${root}`);
process.exitCode = failed ? 1 : 0;

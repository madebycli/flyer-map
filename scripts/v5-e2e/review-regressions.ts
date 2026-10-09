// Reproduces review findings on the real Worker handlers and SQLite fixture.
// Run from repository root: node --experimental-transform-types scripts/v5-e2e/review-regressions.ts
// Assertions capture the reported defects, so passing here means reproduced, not fixed.
import assert from 'node:assert/strict';
import { setup, campaign, NOW, stamp } from '../../tests/helpers/v5Setup.ts';
import { FieldStore } from '../../src/v5/store/store.ts';
import { handleV5Api } from '../../worker/v5/api.ts';
import { createAccessGrant, createSessionForGrant, sessionCookie } from '../../worker/access.ts';

const base = `/api/v5/campaigns/${campaign}`;

// B-F-002: deletion is absent from incremental pulls and cannot clear another client's overlay.
{
  const { call, db } = await setup();
  await call('admin', 'POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 100), key: 'h:stale', status: 'completed', area: 'area_n' }] });
  const first = await (await call('viewer', 'GET', `${base}/state?since=0`)).json();
  const peer = new FieldStore('peer', null, () => NOW);
  peer.receive(first.ops, first.cursor);
  const pruned = await call('admin', 'POST', `${base}/areas/area_n/prune`, { keys: ['h:stale'] });
  assert.equal(pruned.status, 200);
  assert.equal((await pruned.json()).removed, 1);
  const second = await (await call('viewer', 'GET', `${base}/state?since=${peer.lastCursor}`)).json();
  peer.receive(second.ops, second.cursor);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v5_state WHERE key='h:stale'").get()?.n, 0);
  assert.equal(peer.statusOf('h:stale'), 'completed');
  const full = await (await call('viewer', 'GET', `${base}/state?since=0`)).json();
  peer.receive(full.ops, full.cursor);
  assert.equal(peer.statusOf('h:stale'), 'completed');
  console.log('REPRODUCED B-F-002: server deleted progress, peer keeps completed even on a full pull');
}

// B-F-003: valid JSON that is not an object (or contains null items) throws instead of returning 4xx.
{
  const { db } = await setup();
  const { grant } = await createAccessGrant(db, { campaignId: campaign, role: 'admin', teamId: null });
  const session = await createSessionForGrant(db, grant);
  const cookie = sessionCookie(session.sessionSecret).split(';')[0];
  for (const [suffix, body] of [['ops', 'null'], ['notes', 'null'], ['areas/area_n/prune', 'null'], ['ops', '{"ops":[null]}'], ['notes', '{"notes":[null]}']]) {
    const request = new Request(`https://example.test${base}/${suffix}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body });
    await assert.rejects(handleV5Api(request, db), TypeError);
    console.log(`REPRODUCED B-F-003: ${suffix} ${body} throws TypeError`);
  }
}

// B-F-004: an Area recreated after the precheck is live, but forget still removes its progress.
{
  const { call, db } = await setup();
  const row = db.sqlite.prepare("SELECT * FROM areas WHERE id='area_n'").get()!;
  db.sqlite.prepare("DELETE FROM areas WHERE id='area_n'").run();
  const original = db.batch.bind(db);
  let injected = false;
  db.batch = async (statements) => {
    if (!injected) {
      injected = true;
      db.sqlite.prepare('INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(row.id, row.campaign_id, row.team_id, 'Recreated', row.geometry_json, row.created_at, row.updated_at);
      db.sqlite.prepare('INSERT INTO v5_state(campaign_id,key,op_id,status,area_id,actor,grant_id,seq) VALUES(?,?,?,?,?,?,?,?)')
        .run(campaign, 'h:recreated', stamp(NOW - 1), 'completed', 'area_n', 'peer', 'grant_peer', 1);
    }
    return original(statements);
  };
  const result = await call('admin', 'POST', `${base}/areas/area_n/forget`);
  assert.equal(result.status, 200);
  assert.ok(db.sqlite.prepare("SELECT id FROM areas WHERE id='area_n'").get());
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM v5_state WHERE key='h:recreated'").get()?.n, 0);
  console.log('REPRODUCED B-F-004: forget erased new progress of a concurrently recreated live Area');
}

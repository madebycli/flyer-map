import test from 'node:test';
import assert from 'node:assert/strict';
import { campaign, NOW, setup, stamp } from './helpers/v5Setup.ts';
import { handleV5Api } from '../worker/v5/api.ts';
import { listAccessGrants, resolveAccess } from '../worker/access.ts';

type Room = { id: string; areaId: string; teamId: string; status: string; headcount: number; joinMode: string; joinSecret?: string; housesDone: number | null; areaDone: number | null; endedAt: string | null };
const base = `/api/v5/campaigns/${campaign}`;

/** The same area a second time for the team (a second Gebiet), to prove a guest stays in his room's one. */
function secondArea(db: Awaited<ReturnType<typeof setup>>['db']) {
  const t = '2026-09-07T00:00:00.000Z';
  db.sqlite.prepare("INSERT INTO areas(id,campaign_id,team_id,name,geometry_json,created_at,updated_at) VALUES('area_n2',?,'team_n','Second',?,?,?)")
    .run(campaign, JSON.stringify({ type: 'Polygon', coordinates: [[[13.05, 51], [13.06, 51], [13.06, 51.01], [13.05, 51.01], [13.05, 51]]] }), t, t);
}

async function open(call: Awaited<ReturnType<typeof setup>>['call'], who = 'editor', body: Record<string, unknown> = {}) {
  const response = await call(who, 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 6, ...body });
  return { response, room: ((await response.clone().json()) as { room?: Room }).room as Room };
}

/** A request with the cookie a join answered with. */
function asGuest(db: Awaited<ReturnType<typeof setup>>['db'], cookie: string) {
  return async (method: string, path: string, body?: unknown) => (await handleV5Api(new Request(`https://example.test${path}`, {
    method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }), db, { now: () => NOW }))!;
}
const join = async (call: Awaited<ReturnType<typeof setup>>['call'], room: Room, body: Record<string, unknown>, who: string | null = null) => {
  const response = await call(who, 'POST', `/api/v5/rooms/${room.id}/join`, body);
  return { response, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
};

test('the time window: only admins set it, it comes with the meta data, it can be cleared, and an end before the start is refused', async () => {
  const { call } = await setup();
  const meta = async (who: string) => ((await (await call(who, 'GET', `${base}/meta`)).json()) as { window: { startsAt: string | null; endsAt: string | null } | null }).window;
  assert.equal(await meta('admin'), null);
  assert.equal((await call('editor', 'PUT', `${base}/window`, { startsAt: '2026-10-01T08:00:00Z', endsAt: '2026-10-22T20:00:00Z' })).status, 403);
  assert.equal((await call('viewer', 'PUT', `${base}/window`, { endsAt: '2026-10-22T20:00:00Z' })).status, 403);
  assert.equal((await call('admin', 'PUT', `${base}/window`, { startsAt: '2026-10-22T20:00:00Z', endsAt: '2026-10-01T08:00:00Z' })).status, 400);
  assert.equal((await call('admin', 'PUT', `${base}/window`, { endsAt: 'tomorrow-ish' })).status, 400);
  assert.equal((await call('admin', 'PUT', `${base}/window`, { startsAt: '2026-10-01T08:00:00Z', endsAt: '2026-10-22T20:00:00Z' })).status, 200);
  assert.deepEqual(await meta('editor'), { startsAt: '2026-10-01T08:00:00.000Z', endsAt: '2026-10-22T20:00:00.000Z' }, 'every role sees the window');
  assert.deepEqual(await meta('viewer'), await meta('editor'));
  assert.equal((await call('admin', 'PUT', `${base}/window`, { startsAt: null, endsAt: null })).status, 200);
  assert.equal(await meta('admin'), null);
});

test('opening a room: the number of people is required, rights follow the Gebiet, one open room per Gebiet', async () => {
  const { call } = await setup();
  for (const headcount of [undefined, 0, -3, 1.5, 1001, '12', null]) {
    const response = await call('editor', 'POST', `${base}/rooms`, { areaId: 'area_n', ...(headcount === undefined ? {} : { headcount }) });
    assert.equal(response.status, 400, `headcount ${String(headcount)}`);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'headcount_required');
  }
  assert.equal((await call('viewer', 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4 })).status, 403, 'readers do not open rooms');
  assert.equal((await call('other', 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4 })).status, 403, 'not in another Gruppe’s Gebiet');
  assert.equal((await call(null, 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4 })).status, 401);
  assert.equal((await call('editor', 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4, joinMode: 'sesame' })).status, 400);
  assert.equal((await call('editor', 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4, joinMode: 'password' })).status, 400, 'a password room needs a password');
  assert.equal((await call('editor', 'POST', `${base}/rooms`, { areaId: 'area_n', headcount: 4, joinMode: 'password', password: 'abc' })).status, 400, 'and a long enough one');
  const { response, room } = await open(call);
  assert.equal(response.status, 201);
  assert.deepEqual([room.status, room.headcount, room.joinMode, room.teamId], ['active', 6, 'link', 'team_n'], 'the default is joining by link or QR code');
  assert.ok(room.joinSecret && room.joinSecret.length >= 32);
  assert.equal((await open(call, 'admin')).response.status, 409, 'a second room in the same Gebiet');
  const adminRoom = await call('admin', 'POST', `${base}/rooms`, { areaId: 'area_o', headcount: 20 });
  assert.equal(adminRoom.status, 201, 'an admin may open one anywhere');
});

test('who sees which rooms, and who gets the join secret', async () => {
  const { call } = await setup();
  const { room } = await open(call);
  const list = async (who: string) => ((await (await call(who, 'GET', `${base}/rooms`)).json()) as { rooms: Room[] }).rooms;
  assert.equal((await list('editor'))[0].joinSecret, room.joinSecret, 'the Gruppe shows the QR code');
  assert.deepEqual(await list('other'), [], 'another Gruppe sees nothing of it');
  assert.equal((await list('admin')).length, 1);
  const viewer = await list('viewer');
  assert.equal(viewer.length, 1);
  assert.equal(viewer[0].joinSecret, undefined, 'a reader sees the record but cannot join anybody');
  assert.equal((await call(null, 'GET', `${base}/rooms`)).status, 401);
});

test('a guest joins with the link: his access is the Gruppe’s, but only inside the room’s Gebiet', async () => {
  const { db, call } = await setup();
  secondArea(db);
  const { room } = await open(call);
  // the link must be right: the join page learns nothing without it, not even that the room exists
  assert.equal((await call(null, 'GET', `/api/v5/rooms/${room.id}`)).status, 404);
  assert.equal((await call(null, 'GET', `/api/v5/rooms/${room.id}?j=wrong`)).status, 404);
  const info = await (await call(null, 'GET', `/api/v5/rooms/${room.id}?j=${room.joinSecret}`)).json() as { canJoin: boolean; areaName: string; passwordRequired: boolean };
  assert.deepEqual([info.canJoin, info.areaName, info.passwordRequired], [true, 'Area', false]);
  assert.equal((await join(call, room, { label: 'Anna' })).response.status, 404, 'no secret, no join');
  assert.equal((await join(call, room, { label: 'Anna', j: 'x'.repeat(43) })).response.status, 404);
  const { response, cookie } = await join(call, room, { label: 'Anna', j: room.joinSecret });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/);
  assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=57600/, 'the guest session lasts a working day, not a month');
  const guest = asGuest(db, cookie);
  const meta = await (await guest('GET', `${base}/meta`)).json() as { role: string; guestRoom: string; areas: { id: string; writable: boolean }[]; me: { label: string }; contextAreas: unknown[] };
  assert.equal(meta.role, 'team-editor');
  assert.equal(meta.guestRoom, room.id);
  assert.deepEqual(meta.areas.map((a) => [a.id, a.writable]), [['area_n', true]], 'only the room’s Gebiet, not the second one of the Gruppe');
  assert.equal(meta.me.label, 'Anna');
  assert.equal(meta.contextAreas.length, 2, 'the others come as outlines');
  // marking inside works, outside is refused
  const ok = await (await guest('POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 1000), key: 'h:g1', status: 'completed', area: 'area_n' }] })).json() as { accepted: string[] };
  assert.equal(ok.accepted.length, 1);
  const out = await (await guest('POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 900), key: 'h:g2', status: 'completed', area: 'area_n2' }] })).json() as { rejected: { reason: string }[] };
  assert.equal(out.rejected[0].reason, 'area_forbidden');
  assert.equal((await guest('GET', `${base}/areas/area_n2/pack`)).status, 404, 'no data of the other Gebiet');
  const state = await (await guest('GET', `${base}/state?since=0`)).json() as { ops: { key: string }[] };
  assert.deepEqual(state.ops.map((o) => o.key), ['h:g1']);
  // not a manager
  assert.equal((await guest('POST', `${base}/rooms`, { areaId: 'area_n', headcount: 3 })).status, 403);
  assert.equal((await guest('PUT', `${base}/window`, { endsAt: '2026-10-22T20:00:00Z' })).status, 403);
  assert.equal((await guest('POST', `${base}/rooms/${room.id}/finish`, {})).status, 404, 'a guest does not end the room');
  const own = await (await guest('GET', `${base}/rooms`)).json() as { rooms: Room[] };
  assert.deepEqual(own.rooms.map((r) => r.id), [room.id]);
  // and no other endpoint of the system knows this session
  const legacy = new Request('https://example.test/api/campaigns/campaign_n/snapshot', { headers: { cookie } });
  assert.equal(await resolveAccess(db, legacy, campaign), null, 'rooms are not understood outside the v5 API');
  assert.equal((await resolveAccess(db, legacy, campaign, { allowRoom: true }))?.roomId, room.id);
  assert.equal((await listAccessGrants(db, campaign)).some((g) => g.label === 'Anna'), false, 'guests do not fill the list of access links');
});

test('the guest’s access ends with the room, and the result is recorded', async () => {
  const { db, call } = await setup();
  const { room } = await open(call);
  const { cookie } = await join(call, room, { label: 'Ben', j: room.joinSecret });
  const guest = asGuest(db, cookie);
  await call('editor', 'POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 5000), key: 'h:early', status: 'completed', area: 'area_n' }] });
  assert.equal((await guest('POST', `${base}/ops`, { ops: [1, 2, 3].map((n) => ({ id: stamp(NOW - 3000 + n), key: `h:run${n}`, status: 'completed', area: 'area_n' })) })).status, 200);
  await guest('POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 2000), key: 's:street', status: 'completed', area: 'area_n' }] });
  const live = ((await (await call('editor', 'GET', `${base}/rooms`)).json()) as { rooms: Room[] }).rooms[0];
  assert.equal(live.housesDone, 4, 'houses since the room opened, live (streets do not count)');
  assert.equal((await call('other', 'POST', `${base}/rooms/${room.id}/finish`, {})).status, 404);
  assert.equal((await call('viewer', 'POST', `${base}/rooms/${room.id}/finish`, {})).status, 404);
  const finished = await call('editor', 'POST', `${base}/rooms/${room.id}/finish`, { housesTotal: 120 });
  assert.equal(finished.status, 200);
  const done = ((await finished.json()) as { room: Room & { housesTotal: number } }).room;
  assert.deepEqual([done.status, done.housesDone, done.areaDone, done.housesTotal], ['finished', 4, 4, 120]);
  assert.ok(done.endedAt);
  assert.equal(done.joinSecret, undefined, 'a finished room hands out no secret');
  assert.equal((await guest('GET', `${base}/meta`)).status, 401, 'the guest session is over');
  assert.equal((await guest('POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 100), key: 'h:late', status: 'completed', area: 'area_n' }] })).status, 401);
  assert.equal((await join(call, room, { label: 'Late', j: room.joinSecret })).response.status, 403, 'nobody joins a finished room');
  assert.equal((await call('editor', 'POST', `${base}/rooms/${room.id}/finish`, {})).status, 409, 'finishing twice');
  // the result stays: the live number is frozen, a later change does not move it
  await call('editor', 'POST', `${base}/ops`, { ops: [{ id: stamp(NOW - 50), key: 'h:after', status: 'completed', area: 'area_n' }] });
  const again = ((await (await call('admin', 'GET', `${base}/rooms`)).json()) as { rooms: Room[] }).rooms[0];
  assert.equal(again.housesDone, 4);
  // and a new room can be opened in the Gebiet
  assert.equal((await open(call)).response.status, 201);
});

test('join modes: only the Gruppe, with password (and a lock after too many tries), or open to everybody', async () => {
  const { call } = await setup();
  // team: nobody new comes in
  const team = (await open(call, 'editor', { joinMode: 'team' })).room;
  const refused = await join(call, team, { label: 'X', j: team.joinSecret });
  assert.equal(refused.response.status, 403);
  assert.equal(((await refused.response.json()) as { error: { code: string } }).error.code, 'team_only');
  await call('editor', 'POST', `${base}/rooms/${team.id}/finish`, {});
  // password
  const locked = (await open(call, 'editor', { joinMode: 'password', password: 'sommer-2026' })).room;
  assert.equal(((await (await call(null, 'GET', `/api/v5/rooms/${locked.id}`)).json()) as { passwordRequired: boolean }).passwordRequired, true, 'the link is enough to see that a password is needed');
  assert.equal((await join(call, locked, { label: 'Y' })).response.status, 403);
  assert.equal((await join(call, locked, { label: 'Y', password: 'sommer-2025' })).response.status, 403);
  const good = await join(call, locked, { label: 'Y', password: 'sommer-2026' });
  assert.equal(good.response.status, 200);
  assert.ok(good.cookie.startsWith('vf_session='));
  for (let i = 0; i < 8; i++) await join(call, locked, { label: 'Z', password: `guess${i}` });
  const blocked = await join(call, locked, { label: 'Z', password: 'sommer-2026' });
  assert.equal(blocked.response.status, 429, 'after eight wrong tries even the right password has to wait');
  // open: the link alone is enough, also for another Gruppe
  await call('editor', 'POST', `${base}/rooms/${locked.id}/finish`, {});
  const openRoom = (await open(call, 'editor', { joinMode: 'open' })).room;
  assert.equal((await join(call, openRoom, { label: 'Q' })).response.status, 200);
  assert.equal((await join(call, openRoom, { label: 'R' }, 'other')).response.status, 200, 'a member of another Gruppe may join an open room (and gets this room’s access)');
});

test('somebody signed in does not lose his access by accident', async () => {
  const { call } = await setup();
  const { room } = await open(call, 'editor', { joinMode: 'open' });
  assert.equal((await join(call, room, { label: 'a' }, 'admin')).response.status, 409);
  const member = await join(call, room, { label: 'b' }, 'editor');
  assert.equal(member.response.status, 409, 'a member of the Gruppe needs no join');
  assert.equal(((await member.response.json()) as { error: { code: string } }).error.code, 'already_member');
  const guest = await join(call, room, { label: 'c' });
  assert.equal(guest.response.status, 200);
  const again = await handleV5Api(new Request(`https://example.test/api/v5/rooms/${room.id}/join`, { method: 'POST', headers: { cookie: guest.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'c' }) }), (await setup()).db, {});
  assert.ok(again); // another database: the cookie is unknown there, so it simply is no session
});

test('changing a room: any member sets the headcount, only the Gruppe changes the way of joining; nothing changes after the end', async () => {
  const { db, call } = await setup();
  const { room } = await open(call);
  const { cookie } = await join(call, room, { label: 'G', j: room.joinSecret });
  const guest = asGuest(db, cookie);
  assert.equal((await guest('PATCH', `${base}/rooms/${room.id}`, { headcount: 9 })).status, 200, 'a guest says how many people there are');
  assert.equal((await guest('PATCH', `${base}/rooms/${room.id}`, { joinMode: 'open' })).status, 403);
  for (const bad of [0, 1001, 2.5, '5']) assert.equal((await call('editor', 'PATCH', `${base}/rooms/${room.id}`, { headcount: bad })).status, 400);
  assert.equal((await call('editor', 'PATCH', `${base}/rooms/${room.id}`, {})).status, 400);
  assert.equal((await call('other', 'PATCH', `${base}/rooms/${room.id}`, { headcount: 2 })).status, 404);
  assert.equal((await call('viewer', 'PATCH', `${base}/rooms/${room.id}`, { headcount: 2 })).status, 404);
  assert.equal((await call('editor', 'PATCH', `${base}/rooms/${room.id}`, { joinMode: 'password' })).status, 400, 'a new password room needs a password');
  const changed = ((await (await call('editor', 'PATCH', `${base}/rooms/${room.id}`, { joinMode: 'password', password: 'neues-pw' })).json()) as { room: Room }).room;
  assert.equal(changed.joinMode, 'password');
  assert.equal(changed.headcount, 9, 'the guest’s change stuck');
  await call('editor', 'POST', `${base}/rooms/${room.id}/finish`, {});
  assert.equal((await call('editor', 'PATCH', `${base}/rooms/${room.id}`, { headcount: 3 })).status, 409);
});

test('a room belongs to its Aktion, and only an admin deletes one', async () => {
  const { db, call } = await setup();
  const { room } = await open(call);
  const t = '2026-09-07T00:00:00.000Z';
  db.sqlite.prepare("INSERT INTO campaigns(id,name,status,revision,write_token,created_at,updated_at) VALUES('campaign_x','Other','active',1,'seed',?,?)").run(t, t);
  assert.equal((await call('admin', 'PATCH', `/api/v5/campaigns/campaign_x/rooms/${room.id}`, { headcount: 2 })).status, 401, 'no access to the other Aktion at all');
  assert.equal((await call('editor', 'DELETE', `${base}/rooms/${room.id}`)).status, 403);
  const { cookie } = await join(call, room, { label: 'G', j: room.joinSecret });
  assert.equal((await call('admin', 'DELETE', `${base}/rooms/${room.id}`)).status, 200);
  assert.equal((await asGuest(db, cookie)('GET', `${base}/meta`)).status, 401, 'deleting a room ends its guests too');
  assert.deepEqual(((await (await call('admin', 'GET', `${base}/rooms`)).json()) as { rooms: Room[] }).rooms, []);
});

test('guest names are cleaned and a room has a limit', async () => {
  const { db, call } = await setup();
  const { room } = await open(call, 'editor', { joinMode: 'open' });
  const { cookie } = await join(call, room, { label: '  <b>Mo\u0000rgen</b>\n' + 'x'.repeat(100) });
  const meta = await (await asGuest(db, cookie)('GET', `${base}/meta`)).json() as { me: { label: string } };
  assert.ok(!/[<>\u0000\n]/u.test(meta.me.label) && meta.me.label.length <= 40, meta.me.label);
  assert.equal((await join(call, room, {})).response.status, 200, 'no name: just "Gast"');
  db.sqlite.exec(`INSERT INTO v5_room_guests (room_id, grant_id, label, joined_at) ${Array.from({ length: 300 }, (_, i) => `SELECT '${room.id}', 'fill${i}', 'f', 't'`).join(' UNION ALL ')}`);
  assert.equal((await join(call, room, { label: 'late' })).response.status, 429);
});

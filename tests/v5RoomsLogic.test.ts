import assert from 'node:assert/strict';
import test from 'node:test';
import { clock, countdown, roomIntent, roomLinkFor, runFigures, span, teamStats, type RoomRecord } from '../src/v5/app/roomsLogic.ts';

const H = 3_600_000, D = 86_400_000;
const t0 = Date.UTC(2026, 9, 1, 8, 0, 0);

test('span names the two biggest units that matter', () => {
  assert.equal(span(12 * D + 4 * H + 59_000), '12 Tage 4 Std');
  assert.equal(span(1 * D), '1 Tag');
  assert.equal(span(5 * H + 12 * 60_000), '5 Std 12 Min');
  assert.equal(span(3 * H), '3 Std');
  assert.equal(span(42 * 60_000 + 5000), '42 Min');
  assert.equal(span(0), '0 Min');
  assert.equal(span(-5), '0 Min');
});

test('clock: minutes and seconds first, hours and minutes from an hour on', () => {
  assert.equal(clock(65_000), '1:05 Min');
  assert.equal(clock(59 * 60_000 + 59_000), '59:59 Min');
  assert.equal(clock(H + 24 * 60_000 + 30_000), '1:24 Std');
});

test('the countdown has a before, a running and an over phase, and none without a window', () => {
  assert.deepEqual(countdown(null, t0), { phase: 'none' });
  assert.deepEqual(countdown({ startsAt: null, endsAt: null }, t0), { phase: 'none' });
  const window = { startsAt: new Date(t0).toISOString(), endsAt: new Date(t0 + 21 * D).toISOString() };
  const before = countdown(window, t0 - 3 * D);
  assert.equal(before.phase, 'before');
  assert.match((before as { text: string }).text, /^Startet in 3 Tage/);
  const running = countdown(window, t0 + 9 * D + 4 * H) as Extract<ReturnType<typeof countdown>, { phase: 'running' }>;
  assert.equal(running.phase, 'running');
  assert.equal(running.text, 'Noch 11 Tage 20 Std');
  assert.ok(Math.abs((running.elapsed ?? 0) - (9 * D + 4 * H) / (21 * D)) < 1e-9);
  assert.equal(running.urgent, false);
  assert.equal((countdown(window, t0 + 20 * D) as { urgent: boolean }).urgent, true, 'the last two days are urgent');
  const over = countdown(window, t0 + 22 * D + 2 * H);
  assert.equal(over.phase, 'over');
  assert.match((over as { text: string }).text, /^Zeitfenster vorbei seit 1 Tag 2 Std/);
  // only an end: it runs from now on; only a start: nothing to count down
  assert.equal(countdown({ startsAt: null, endsAt: new Date(t0 + D).toISOString() }, t0).phase, 'running');
  assert.equal(countdown({ startsAt: new Date(t0).toISOString(), endsAt: null }, t0 + D).phase, 'none');
});

const room = (over: Partial<RoomRecord>): RoomRecord => ({
  id: 'r', areaId: 'a', areaName: 'Nord', teamId: 't1', teamName: 'Alpha', teamColor: '#4f8cff', status: 'finished', headcount: 5, joinMode: 'link', passwordSet: false,
  startedAt: new Date(t0).toISOString(), endedAt: new Date(t0 + 2 * H).toISOString(), startedBy: 'x', housesTotal: 400, housesDone: 100, areaDone: 120, ...over,
});

test('the numbers of a run: hours, people-hours, houses, share of the Gebiet, houses per person and hour', () => {
  const f = runFigures(room({}), t0);
  assert.equal(f.hours, 2);
  assert.equal(f.personHours, 10);
  assert.equal(f.houses, 100);
  assert.equal(f.percent, 25);
  assert.equal(f.perPersonHour, 10);
  assert.equal(runFigures(room({ housesTotal: null }), t0).percent, null, 'unknown total: no invented percentage');
  assert.equal(runFigures(room({ housesTotal: 0 }), t0).percent, null);
  const running = runFigures(room({ status: 'active', endedAt: null, housesDone: 30 }), t0 + 3 * H);
  assert.equal(running.hours, 3, 'a running room is measured up to now');
  assert.equal(running.houses, 30);
});

test('the headcount is what counts: people-hours use it, not any number of devices', () => {
  assert.equal(runFigures(room({ headcount: 20 }), t0).personHours, 40);
  assert.equal(runFigures(room({ headcount: 2 }), t0).personHours, 4);
});

test('per Gruppe and in total, finished runs only, the best Gruppe first', () => {
  const rooms = [
    room({ id: '1', housesDone: 100 }),
    room({ id: '2', housesDone: 50, headcount: 3, endedAt: new Date(t0 + H).toISOString() }),
    room({ id: '3', teamId: 't2', teamName: 'Beta', housesDone: 400, headcount: 10 }),
    room({ id: '4', status: 'active', endedAt: null, housesDone: 999 }),
  ];
  const { total, teams } = teamStats(rooms, t0 + 10 * H);
  assert.deepEqual(teams.map((t) => [t.name, t.runs, t.houses]), [['Beta', 1, 400], ['Alpha', 2, 150]]);
  assert.equal(total.runs, 3, 'the running room is not part of the record yet');
  assert.equal(total.houses, 550);
  const alpha = teams.find((t) => t.name === 'Alpha')!;
  assert.equal(alpha.hours, 3);
  assert.equal(alpha.personHours, 13);
  assert.equal(alpha.averagePeople, 4);
  assert.ok(Math.abs((alpha.perPersonHour ?? 0) - 150 / 13) < 1e-9);
  assert.deepEqual(teamStats([], t0).teams, []);
});

test('the room link carries the secret in the fragment and is read back', () => {
  const link = roomLinkFor('https://x.test', 'campaign_1', 'room_abc', 'S'.repeat(43));
  assert.equal(link, `https://x.test/v5?campaign=campaign_1&room=room_abc#j=${'S'.repeat(43)}`);
  const url = new URL(link);
  assert.deepEqual(roomIntent(url.search, url.hash), { campaignId: 'campaign_1', roomId: 'room_abc', secret: 'S'.repeat(43) });
  assert.equal(roomIntent('?campaign=c&room=r', '')!.secret, null, 'no secret: the open and password modes');
  assert.equal(roomIntent('?campaign=c', ''), null);
  assert.equal(roomIntent('?campaign=c&room=bad id', ''), null);
  assert.equal(roomIntent('?campaign=c&room=r', '#j=short')!.secret, null);
  assert.ok(!roomLinkFor('https://x.test', 'c', 'r', null).includes('#'));
});

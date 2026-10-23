// The Akteur of an Aktion in a real Durable Object (workerd, SQLite storage): the commands over HTTP, the live channel over real WebSockets, what each device
// is told, the object waking from hibernation, and rights that end. Run by server-local.sh against a server built with `--features probe`.
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const base = process.env.BASE ?? 'http://127.0.0.1:8791';
const SETUP_KEY = process.env.SETUP_KEY ?? 'local-setup-key';
const PASSWORD = 'correct horse battery';
let checks = 0;
const ok = (cond, what) => { checks++; assert.ok(cond, what); };
const is = (actual, expected, what) => { checks++; assert.deepEqual(actual, expected, `${what}: got ${JSON.stringify(actual)}`); };

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== 'GET' && !h.origin) h.origin = base;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const set = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: set ? set.split(';')[0] : null };
}

const opId = (wall, node = 'e2e') => `${wall.toString(36).padStart(11, '0')}-${(0).toString(36).padStart(4, '0')}-${node}`;
const square = (x, y) => [[x, y], [x + 0.005, y], [x + 0.005, y + 0.005], [x, y + 0.005], [x, y]];
let cid = 0;
const command = (body) => ({ cid: `e2e-${Date.now()}-${cid++}`, body });
const markBody = (gebiet, keys) => ({ t: 'marks', gebiet, marks: keys.map((key) => ({ key, status: 'completed', op: opId(Date.now()) })) });

// a WebSocket the way a page opens it, with everything it receives collected
function socket(aktion, cookie, origin = base) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/v6/aktionen/${aktion}/live`, { headers: { cookie, origin } });
  const inbox = [];
  ws.on('message', (data) => inbox.push(JSON.parse(String(data))));
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error(`handshake answered ${res.statusCode}`), { status: res.statusCode })));
    ws.on('error', reject);
  });
  const send = (msg) => ws.send(JSON.stringify({ v: 6, msg }));
  const take = () => inbox.splice(0);
  return { ws, inbox, closed, opened, send, take };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(what, test, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const got = test();
    if (got) return got;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(25);
  }
}
const kinds = (frames) => frames.map((f) => f.msg.t);
const entriesOf = (frames) => frames.filter((f) => f.msg.t === 'entries').flatMap((f) => f.msg.entries);

// 0. the transactions of a real Durable Object are all-or-nothing
const probe = await call('GET', '/__probe/atomic');
is(probe.status, 200, 'probe answered (server built with --features probe)');
for (const step of probe.json.steps) ok(step.passed, `DoSql::atomically: ${step.step} (${step.detail})`);

// 1. an Organisation with an Aktion, two Gruppen and a Gebiet each
const handle = `live-${Date.now().toString(36)}`;
const made = await call('POST', '/v6/organisations', { body: { name: 'Verein', owner: { handle, display_name: 'Anna', password: PASSWORD } }, headers: { 'x-setup-key': SETUP_KEY } });
is(made.status, 201, 'organisation created');
const owner = made.cookie, org = made.json.organisation.id;
const aktion = (await call('POST', '/v6/aktionen', { body: { org_id: org, name: 'Herbst' }, cookie: owner })).json.aktion.id;
const push = (cookie, ...bodies) => call('POST', `/v6/aktionen/${aktion}/push`, { body: { commands: bodies.map(command) }, cookie });
const setup = await push(
  owner,
  { t: 'gruppe', gruppe: { id: 'nord', name: 'Nord', color: 3, base_rev: 0 } },
  { t: 'gruppe', gruppe: { id: 'sued', name: 'Süd', color: 5, base_rev: 0 } },
  { t: 'gebiet', gebiet: { id: 'n1', art: 'austeilen', gruppe: 'nord', name: 'n1', ring: square(13.0, 51.0), base_rev: 0 } },
  { t: 'gebiet', gebiet: { id: 's1', art: 'austeilen', gruppe: 'sued', name: 's1', ring: square(13.1, 51.0), base_rev: 0 } },
);
is(setup.status, 200, 'commands pushed');
is(setup.json.answers.map((a) => a.verdict.t), ['accepted', 'accepted', 'accepted', 'accepted'], 'all four accepted');
is(setup.json.head, 4, 'four entries in the log');
const snapshot = await call('GET', `/v6/aktionen/${aktion}/snapshot`, { cookie: owner });
is([snapshot.json.gruppen.length, snapshot.json.gebiete.length, snapshot.json.head], [2, 2, 4], 'the snapshot has what was pushed');

// 2. who gets in
const guest = async (gruppe) => {
  const invite = await call('POST', '/v6/invites', { body: { role: 'member', scope: { kind: 'gruppe', org, aktion, gruppe } }, cookie: owner });
  const joined = await call('POST', '/v6/invites/redeem', { body: { code: invite.json.code, display_name: gruppe, label: 'Handy' } });
  return joined.cookie;
};
const [nord, sued] = [await guest('nord'), await guest('sued')];
const stranger = (await call('POST', '/v6/organisations', { body: { name: 'Fremd', owner: { handle: `${handle}-x`, password: PASSWORD } }, headers: { 'x-setup-key': SETUP_KEY } })).cookie;
is((await call('GET', `/v6/aktionen/${aktion}/snapshot`, { cookie: stranger })).json.error.code, 'not_found', 'a stranger gets not_found');
is((await call('GET', `/v6/aktionen/${aktion}/snapshot`)).status, 401, 'no session, no access');
is((await push(nord, markBody('s1', ['h:1']))).json.answers[0].verdict.reason.code, 'forbidden', 'a member does not mark in another Gruppe (an answer, not an error)');
const evil = socket(aktion, owner, 'https://evil.test');
await assert.rejects(evil.opened, (e) => e.status === 403, 'a socket from another site is refused');
ok(true, 'cross-origin socket refused');
const noCookie = socket(aktion, '');
await assert.rejects(noCookie.opened, (e) => e.status === 401, 'a socket without a session is refused');
ok(true, 'socket without session refused');

// 3. the live channel: each device is told what it may see
const [so, sn, ss] = [socket(aktion, owner), socket(aktion, nord), socket(aktion, sued)];
await Promise.all([so.opened, sn.opened, ss.opened]);
for (const s of [so, sn, ss]) {
  const hello = await until('hello', () => s.inbox.find((f) => f.msg.t === 'hello'));
  is(hello.msg.head, 4, 'greeted with the head of the log');
  s.send({ t: 'subscribe' });
}
await sleep(300);
[so, sn, ss].forEach((s) => s.take());
await push(owner, markBody('n1', ['h:1', 'h:2']));
const gotOwner = await until('owner entries', () => { const e = entriesOf(so.inbox); return e.length === 2 && e; });
const gotNord = await until('nord entries', () => { const e = entriesOf(sn.inbox); return e.length === 2 && e; });
is(gotOwner.map((e) => e.change.key), ['h:1', 'h:2'], 'the owner is told both marks');
is(gotNord.map((e) => e.change.key), ['h:1', 'h:2'], 'the member of the Gruppe is told both marks');
await sleep(400);
is(entriesOf(ss.inbox), [], 'the member of the other Gruppe is told nothing of it');
sn.send({ t: 'command', command: command(markBody('n1', ['h:3'])) });
const answer = await until('answer', () => sn.inbox.find((f) => f.msg.t === 'answer'));
is(answer.msg.answer.verdict.applied, 1, 'a command over the socket is answered');
await until('news for the owner', () => entriesOf(so.inbox).some((e) => e.change.key === 'h:3'));
sn.send({ t: 'ping', n: 7 });
await until('pong', () => sn.inbox.find((f) => f.msg.t === 'pong' && f.msg.n === 7));
sn.send({ t: 'subscribe', since: 4 });
const caughtUp = await until('catch-up', () => { const e = entriesOf(sn.inbox).filter((x) => x.seq <= 6); return e.length >= 2 && e; });
ok(caughtUp.length >= 2, 'subscribing from a position replays what was missed');

// 4. the object sleeps with the devices connected, and wakes for the next frame
console.log('  waiting for the Durable Object to hibernate (12 s)');
await sleep(12_000);
[so, sn, ss].forEach((s) => s.take());
sn.send({ t: 'command', command: command(markBody('n1', ['h:4'])) });
await until('answer after hibernation', () => sn.inbox.find((f) => f.msg.t === 'answer'));
await until('news after hibernation (the connection table survived)', () => entriesOf(so.inbox).some((e) => e.change.key === 'h:4'));
is(entriesOf(ss.inbox).filter((e) => e.change.key === 'h:4'), [], 'and the other Gruppe is still told nothing');

// 5. rights that end close the connections they let in
const people = await call('GET', `/v6/aktionen/${aktion}/people`, { cookie: owner });
const nordGrant = people.json.people.find((p) => p.display_name === 'nord' && p.role === 'member').grant_id;
is((await call('DELETE', `/v6/grants/${nordGrant}`, { cookie: owner })).status, 200, 'the grant of the nord member ends');
const nordClosed = await Promise.race([sn.closed, sleep(5000).then(() => 'still open')]);
ok(nordClosed !== 'still open', 'the connection of the person whose grant ended is closed');
ok(kinds(sn.inbox).includes('error'), 'and told why');
ok(so.ws.readyState === WebSocket.OPEN && ss.ws.readyState === WebSocket.OPEN, 'the others stay');
is((await call('GET', `/v6/aktionen/${aktion}/snapshot`, { cookie: nord })).json.error.code, 'not_found', 'and the access is gone');
is((await call('POST', '/v6/session/logout', { body: {}, cookie: sued })).status, 200, 'signing out');
const suedClosed = await Promise.race([ss.closed, sleep(5000).then(() => 'still open')]);
ok(suedClosed !== 'still open', 'closes the connection of that session');
ok(so.ws.readyState === WebSocket.OPEN, 'the owner stays connected');
so.ws.close();

console.log(`all ${checks} checks passed against ${base}`);
process.exit(0);

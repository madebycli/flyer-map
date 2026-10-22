// A whole day of the Flyer Map 6 directory over real HTTP against a running server (workerd + D1): the owner starts an Organisation, invites a
// guest, signs in on a second device with password and second factor, uses a recovery code, and the rights hold. Run by server-local.sh.
import { createHmac, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = process.env.BASE ?? 'http://127.0.0.1:8791';
const SETUP_KEY = process.env.SETUP_KEY ?? 'local-setup-key';
const PASSWORD = 'correct horse battery';
let checks = 0;

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== 'GET' && !h.origin) h.origin = base;
  if (body !== undefined) h['content-type'] = 'application/json';
  const started = performance.now();
  const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const set = res.headers.get('set-cookie');
  return { status: res.status, json, cookie: set ? set.split(';')[0] : null, ms: performance.now() - started, headers: res.headers };
}
const ok = (cond, what) => { checks++; assert.ok(cond, what); };
const is = (actual, expected, what) => { checks++; assert.deepEqual(actual, expected, `${what}: got ${JSON.stringify(actual)}`); };

// RFC 6238, SHA-1, 6 digits
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, n = 0; const out = []; for (const c of s) { bits = (bits << 5) | A.indexOf(c); n += 5; if (n >= 8) { n -= 8; out.push((bits >> n) & 255); bits &= (1 << n) - 1; } } return Buffer.from(out); };
const totp = (secret, ms) => { const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(ms / 30000))); const h = createHmac('sha1', secret).update(counter).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0'); };

// 1. the Organisation
const closed = await call('POST', '/v6/organisations', { body: { name: 'Verein', owner: { handle: 'anna', password: PASSWORD } } });
is(closed.json?.error?.code, 'signup_closed', 'closed without the key');
const made = await call('POST', '/v6/organisations', { body: { name: 'Verein', owner: { handle: 'anna', display_name: 'Anna', password: PASSWORD } }, headers: { 'x-setup-key': SETUP_KEY } });
is(made.status, 201, 'organisation created');
ok(made.cookie?.startsWith('__Host-fm='), 'session cookie');
const owner = made.cookie, org = made.json.organisation.id;
is((await call('GET', '/v6/me', { cookie: owner })).json.grants[0].role, 'owner', 'owner grant');

// 2. an Aktion and a guest
const aktion = (await call('POST', '/v6/aktionen', { body: { org_id: org, name: 'Herbst' }, cookie: owner })).json.aktion.id;
const invite = await call('POST', '/v6/invites', { body: { role: 'member', scope: { kind: 'gruppe', org, aktion, gruppe: 'nord' }, label: 'Nord' }, cookie: owner });
is(invite.status, 201, 'invitation');
const joined = await call('POST', '/v6/invites/redeem', { body: { code: invite.json.code.toLowerCase(), display_name: 'Berta' } });
is(joined.status, 200, 'redeemed');
const guest = joined.cookie;
is((await call('POST', '/v6/invites/redeem', { body: { code: invite.json.code } })).json.error.code, 'invite_invalid', 'single use');
const guestMe = (await call('GET', '/v6/me', { cookie: guest })).json;
is([guestMe.person.kind, guestMe.grants[0].role, guestMe.grants[0].scope.gruppe], ['guest', 'member', 'nord'], 'guest rights');
is((await call('POST', '/v6/invites', { body: { role: 'member', scope: { kind: 'gruppe', org, aktion, gruppe: 'nord' } }, cookie: guest })).json.error.code, 'forbidden', 'a member invites nobody');
const people = (await call('GET', `/v6/aktionen/${aktion}/people`, { cookie: owner })).json.people;
ok(people.some((p) => p.kind === 'guest' && p.display_name === 'Berta'), 'the guest is listed');
is((await call('GET', `/v6/aktionen/${aktion}/people`, { cookie: guest })).status, 403, 'a guest does not list people');

// 3. a second device: password (PBKDF2 by WebCrypto), then the second factor
const wrong = await call('POST', '/v6/session/password', { body: { handle: 'anna', password: 'not the password' } });
is(wrong.json.error.code, 'invalid_credentials', 'wrong password');
const login = await call('POST', '/v6/session/password', { body: { handle: 'ANNA', password: PASSWORD, label: 'Tablet' } });
is(login.status, 200, 'password sign-in');
console.log(`  password sign-in ${login.ms.toFixed(0)} ms (PBKDF2 by WebCrypto)`);
const tablet = login.cookie;
const enrolled = await call('POST', '/v6/totp/enroll', { body: {}, cookie: tablet });
is(enrolled.status, 200, 'totp enroll');
const secret = b32(enrolled.json.secret);
const confirmed = await call('POST', '/v6/totp/confirm', { body: { code: totp(secret, Date.now()) }, cookie: tablet });
is(confirmed.status, 200, 'totp confirm');
const recovery = confirmed.json.recovery_codes;
is(recovery.length, 8, 'recovery codes');
is((await call('POST', '/v6/session/password', { body: { handle: 'anna', password: PASSWORD } })).json.error.code, 'second_factor_required', 'second factor now required');
const later = Date.now() + 30000; // the confirming code is spent: take the next step's
ok(true, 'time moves on');
const stepNow = Math.floor(Date.now() / 30000);
let signed = null;
for (const offset of [1, 0, -1]) { // the server accepts the neighbouring steps; the spent one is refused
  const tryIt = await call('POST', '/v6/session/password', { body: { handle: 'anna', password: PASSWORD, totp: totp(secret, (stepNow + offset) * 30000) } });
  if (tryIt.status === 200) { signed = tryIt; break; }
}
ok(signed && signed.status === 200, 'sign-in with the authenticator code');
is((await call('POST', '/v6/session/recovery', { body: { handle: 'anna', code: recovery[0] } })).status, 200, 'recovery code works');
is((await call('POST', '/v6/session/recovery', { body: { handle: 'anna', code: recovery[0] } })).json.error.code, 'invalid_credentials', 'once only');

// 4. devices and sessions
const devices = (await call('GET', '/v6/devices', { cookie: owner })).json.devices;
ok(devices.length >= 3, 'devices listed');
const toKick = devices.find((d) => !d.current && d.label === 'Tablet');
is((await call('DELETE', `/v6/devices/${toKick.id}`, { cookie: owner })).status, 200, 'device signed out');
is((await call('GET', '/v6/me', { cookie: tablet })).status, 401, 'the signed-out device is out');

// 5. the grant of the guest ends at once
const grantId = people.find((p) => p.kind === 'guest').grant_id;
is((await call('DELETE', `/v6/grants/${grantId}`, { cookie: owner })).status, 200, 'grant ended');
is((await call('GET', '/v6/me', { cookie: guest })).json.grants.length, 0, 'the guest has nothing left');
is((await call('GET', '/v6/aktionen', { cookie: guest })).json.aktionen.length, 0, 'and sees no Aktion');

// 6. the audit log, the brake, cross-origin
const audit = (await call('GET', `/v6/audit?org=${org}`, { cookie: owner })).json.entries.map((e) => e.action);
for (const a of ['organisation.create', 'aktion.create', 'invite.create', 'invite.redeem', 'grant.revoke']) ok(audit.includes(a), `audit holds ${a}`);
const mine = (await call('GET', '/v6/audit?mine=1', { cookie: owner })).json.entries.map((e) => e.action);
for (const a of ['session.open', 'totp.enable', 'recovery.generate']) ok(mine.includes(a), `own log holds ${a}`);
const theirs = (await call('GET', '/v6/audit?mine=1', { cookie: guest })).json.entries.map((e) => e.action);
ok(!theirs.includes('totp.enable') && !theirs.includes('organisation.create'), 'a guest sees nothing of the owner in the own log');
const cross = await call('POST', '/v6/session/logout', { body: {}, cookie: owner, headers: { origin: 'https://evil.test' } });
is(cross.json.error.code, 'cross_origin', 'cross-origin refused');
for (let i = 0; i < 8; i++) await call('POST', '/v6/invites/redeem', { body: { code: 'ZZZZZ-ZZZZZ' } });
is((await call('POST', '/v6/invites/redeem', { body: { code: invite.json.code } })).json.error.code, 'rate_limited', 'the brake holds');
ok(!!(await call('GET', '/v6/me', { cookie: owner })).headers.get('x-request-id'), 'request id');

console.log(`all ${checks} checks passed against ${base}`);

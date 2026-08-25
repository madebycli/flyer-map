---
id: ADR-0014
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0014: Live Field Group lifecycle, discovery and temporary join credentials

## Status

Proposed only. The discovery/list behavior was clarified on 2026-08-26, but join-access bootstrap and credential lifetime details remain security decisions. No join-code, QR or Field Group credential runtime implementation is authorized yet.

## Context

Plan 012 separates persistent Teams from temporary Field Groups used during one outing/session. Temporary join material must never silently grant persistent Team/Admin access.

Current security boundaries remain:
- Worker authorization is authoritative;
- ids are selectors, never credentials;
- M5 mutation/conflict handling remains the concurrency baseline;
- no public internet directory of active groups;
- no continuous GPS surveillance;
- no persistent Admin/Team access token may be embedded in a temporary Field Group QR.

## Confirmed product direction

A Field Group belongs to one Campaign/action and one persistent Team.

When a group is created:
- it receives a room code;
- it receives a QR join representation;
- its creator/manager can control a setting such as `online anzeigen`;
- hiding it from the online list does not have to destroy the room code/QR;
- closing the group invalidates future joining according to server-side policy.

The Campaign has an online-groups list.

Default list behavior:
- show all active discoverable groups in the current Campaign/action;
- `Alle in der Aktion` is the default filter;
- user may filter to one Team to see only online groups belonging to that Team;
- Team identity/color should remain visible in each list item;
- groups with `online anzeigen = false` are excluded from discovery but may still be reachable by valid direct room code/QR according to the final join policy.

There is no global/public list across unrelated Campaigns or Organizations.

## Proposed lifecycle

A Field Group has an application-owned random id and belongs to exactly one Campaign + Team.

Proposed states:
- `active`: join allowed according to policy;
- `closed`: no new joins and temporary credentials invalid;
- optional `expired`: server closes stale active groups after bounded lifetime.

Creating a Field Group may start or attach to one Field Session, but exact event/session persistence remains governed by ADR-0017 once accepted.

## Discoverability

Confirmed visibility model:
- `discoverable = true` exposes the active group in the current Campaign online-groups list;
- `discoverable = false` hides it from that list;
- discoverability is a group setting controlled only by an authorized creator/manager;
- the list defaults to all discoverable groups in the Campaign;
- an optional Team filter narrows the already-authorized Campaign list;
- no filter may widen access beyond the Campaign boundary.

Discovery responses should expose only operational fields required to choose a group:
- group display label;
- Team id/name/color;
- coarse progress/session state if later approved;
- join availability;
- never exact participant GPS/device fingerprint data.

## Temporary credentials

### Human room code

Proposed manual code:
- 10 characters from a human-safe Base32 alphabet;
- generated from cryptographically secure random bytes;
- case-insensitive presentation is allowed if canonical decoding is unambiguous;
- never sequential and never derived from group id/name;
- expires/invalidates with group policy and can be rotated/revoked immediately;
- stored server-side only as a hash/derived lookup value, never plaintext after issuance where lookup design permits;
- strict join throttling is mandatory.

Ten Base32 characters provide about 50 bits of random code space before online rate limiting.

### QR join token

QR should carry a separate high-entropy opaque join token, not the short manual code and not any persistent Campaign/Admin token.

Proposed token:
- at least 128 bits of cryptographic randomness;
- opaque, non-semantic value;
- server stores only a hash/derived representation;
- same group scope/expiry/revocation as the QR credential record;
- redemption creates server-side membership/session state, after which the QR token itself is not trusted as the ongoing authorization session.

## Optional group password

A separate optional group password is not required for the first slice. If added later:
- it is an additional factor on the temporary join flow, never a replacement for secure random join material;
- never stored/logged plaintext;
- hashing strategy must reuse an accepted credential-hashing design rather than inventing a second password scheme;
- online attempt limits remain mandatory because human passwords have low entropy.

## Membership

Successful join creates explicit Field Group membership tied to a server-revocable scoped session/member record.

Membership grants only the effective Field Group/Team capabilities defined by current/future authorization policy. It never grants Organization Admin or persistent Team invitation rights.

Closing/removing membership is checked server-side on subsequent privileged requests.

## Still unresolved: can a room code/QR bootstrap Campaign access?

### Option J1: existing Campaign authorization required

Code/QR only joins a Field Group after the device already has valid Campaign access.

Benefits:
- simplest security model;
- temporary code never acts as a Campaign credential;
- discovery and joining use the same established Campaign authorization boundary.

Trade-off:
- every new device/person needs a separate Campaign/Team access step before joining the live group.

### Option J2: room code/QR may bootstrap temporary group-scoped access

A valid join credential may establish a temporary session whose authorization is limited to the target Field Group/Team and expires/revokes with membership.

Benefits:
- much simpler field onboarding from QR/code;
- no separate persistent invite needed for short-lived helpers.

Trade-offs:
- join endpoint becomes an authentication boundary exposed to brute-force/replay risk;
- scope mapping and revocation need stronger tests;
- temporary session must be clearly prevented from becoming persistent Team/Admin authority.

The discovery/filter decision above does not decide J1/J2. This ADR remains proposed until that security/product choice is selected.

## Rate limiting and abuse controls

Current Cloudflare Workers provides a Rate Limiting binding. Proposed defense in depth:
- one coarse route limiter for join endpoints;
- a second keyed limiter based on canonical code/group lookup key when available;
- generic invalid/expired responses to avoid useful enumeration;
- bounded request body and schema validation;
- bounded credential lifetime/revocation;
- server-side revocation check on every redemption;
- audit/activity event for credential rotate/close and suspicious repeated failures once event storage exists.

Rate limiting is a defense in depth control, not a substitute for code entropy.

## Offline behavior

Already-joined devices may continue using the existing M5 local mutation queue while offline if their local Campaign/session state was previously authorized. Offline state does not allow joining a new Field Group because credential redemption/revocation requires the Worker.

When connectivity returns, revoked/closed membership must stop privileged sync rather than blindly retrying.

## Security non-goals

- no public group directory;
- no GPS route tracking;
- no permanent device fingerprint;
- no persistent Admin/Team token in QR;
- no client-only membership authorization;
- no reusable forever join code.

## Acceptance required before implementation

Before D1 schema/routes are implemented:
1. select J1 or J2;
2. confirm code alphabet/length and expiry/rotation policy;
3. define Field Group maximum lifetime and close behavior;
4. define membership/session relationship to current Campaign sessions;
5. define exact server-side authorization matrix for group members;
6. add rate-limit binding configuration and brute-force/revocation tests;
7. define minimal audit events without logging join secrets.

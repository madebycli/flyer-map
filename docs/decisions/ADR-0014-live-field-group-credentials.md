---
id: ADR-0014
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0014: Live Field Group lifecycle, discovery and temporary join credentials

## Status

Proposed overall. Product choices for discovery, temporary join bootstrap and credential/group lifetime were clarified on 2026-08-26. The confirmed lifetime rule is: a Field Group is normally closed manually when the tour ends, and any still-open group plus its Room Code/QR credentials expires automatically after a hard maximum of 24 hours. Exact authorization mapping, rate-limit configuration and remaining credential implementation details are still security decisions. No join-code, QR or Field Group credential runtime implementation is authorized yet.

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
- `online anzeigen` defaults to **enabled** for a newly created group;
- its creator/manager can disable `online anzeigen` explicitly;
- hiding it from the online list does not have to destroy the room code/QR;
- the group is intended for one short field tour, commonly around 2 to 3 hours;
- the group is normally ended manually when the tour ends;
- closing the group immediately invalidates future joining;
- if nobody closes it, the group and its join credentials expire automatically after at most 24 hours from creation.

Participant count is operational Field Session data, not credential data:
- the number of people in the group can be entered or updated while the tour is running;
- the final participant count must be present when the tour/group is ended so later person-time/statistics can use it;
- this count never changes authentication scope or grants authority.

The Campaign has an online-groups list.

Default list behavior:
- show all active discoverable groups in the current Campaign/action;
- `Alle in der Aktion` is the default filter;
- user may filter to one Team to see only online groups belonging to that Team;
- Team identity/color should remain visible in each list item;
- groups with `online anzeigen = false` are excluded from discovery but may still be reachable by valid direct room code/QR while the group remains joinable.

There is no global/public list across unrelated Campaigns or Organizations.

## Confirmed lifecycle

A Field Group has an application-owned random id and belongs to exactly one Campaign + Team.

Lifecycle:
- `active`: join allowed according to policy;
- `closed`: manually ended, no new joins and temporary credentials immediately invalid;
- `expired`: server closes a still-active group automatically when its hard 24-hour lifetime is reached.

The intended normal lifecycle is `active -> closed` after the real tour, usually after roughly 2 to 3 hours. `expired` is a safety fallback, not the normal workflow.

The 24-hour hard limit applies to the Field Group and the Room Code/QR join credentials. Rotating a credential must not extend the Field Group beyond its original maximum expiry unless a future accepted ADR explicitly changes that rule.

Creating a Field Group may start or attach to one Field Session. The participant count can be updated during the session and must be finalized when the session/group is manually ended. Exact event/session persistence remains governed by ADR-0017 once accepted.

## Discoverability

Confirmed visibility model:
- a newly created Field Group starts with `discoverable = true`;
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
- never room-code/QR secrets in list data;
- never exact participant GPS/device fingerprint data.

## Temporary credentials

### Human room code

Proposed manual code:
- 10 characters from a human-safe Base32 alphabet;
- generated from cryptographically secure random bytes;
- case-insensitive presentation is allowed if canonical decoding is unambiguous;
- never sequential and never derived from group id/name;
- expires immediately when the group closes and no later than the group hard expiry at 24 hours;
- can be rotated/revoked immediately without extending the group's 24-hour maximum lifetime;
- stored server-side only as a hash/derived lookup value, never plaintext after issuance where lookup design permits;
- strict join throttling is mandatory.

Ten Base32 characters provide about 50 bits of random code space before online rate limiting.

### QR join token

QR should carry a separate high-entropy opaque join token, not the short manual code and not any persistent Campaign/Admin token.

Proposed token:
- at least 128 bits of cryptographic randomness;
- opaque, non-semantic value;
- server stores only a hash/derived representation;
- same group scope and manual-close/hard-24-hour expiry boundary as the QR credential record;
- redemption creates server-side membership/session state, after which the QR token itself is not trusted as the ongoing authorization session.

## Optional group password

A separate optional group password is not required for the first slice. If added later:
- it is an additional factor on the temporary join flow, never a replacement for secure random join material;
- never stored/logged plaintext;
- hashing strategy must reuse an accepted credential-hashing design rather than inventing a second password scheme;
- online attempt limits remain mandatory because human passwords have low entropy.

## Confirmed access bootstrap: temporary group-scoped access

The selected product direction is equivalent to former option J2:

A person/device that does **not** already have Campaign access may redeem a valid room code or QR token and receive a temporary server-side session scoped to the target Field Group/Team.

This temporary join must:
- authorize only the capabilities needed for that Field Group/Team according to the final capability policy;
- never grant Organization Organizer/Admin authority;
- never grant persistent Team invitation/management authority merely because the code was redeemed;
- expire/revoke with membership/group policy and never outlive the Field Group hard expiry;
- be revocable server-side immediately;
- require online Worker redemption before first join;
- be protected against brute force/replay with entropy, expiry, rate limiting and generic failure responses.

A successful temporary join is therefore an authentication/bootstrap boundary, not merely a UI convenience.

## Membership

Successful join creates explicit Field Group membership tied to a server-revocable scoped session/member record.

Membership grants only the effective Field Group/Team capabilities defined by current/future authorization policy. It never grants Organization Organizer/Admin or persistent Team invitation rights.

Closing/removing membership is checked server-side on subsequent privileged requests. A group reaching the 24-hour hard expiry is treated as closed for authorization purposes even if a stale client still displays it locally.

## Rate limiting and abuse controls

Current Cloudflare Workers provides a Rate Limiting binding. Proposed defense in depth:
- one coarse route limiter for join endpoints;
- a second keyed limiter based on canonical code/group lookup key when available;
- generic invalid/expired responses to avoid useful enumeration;
- bounded request body and schema validation;
- hard 24-hour group/credential lifetime plus immediate manual close/revocation;
- server-side revocation check on every redemption;
- audit/activity event for credential rotate/close/expiry and suspicious repeated failures once event storage exists.

Rate limiting is a defense in depth control, not a substitute for code entropy.

## Offline behavior

Already-joined devices may continue using the existing M5 local mutation queue while offline if their local temporary session/group membership was previously authorized and the queued mutations are within its scope. Offline state does not allow joining a new Field Group because credential redemption/revocation requires the Worker.

When connectivity returns, revoked/closed/expired membership must stop privileged sync rather than blindly retrying.

## Security non-goals

- no public group directory;
- no GPS route tracking;
- no permanent device fingerprint;
- no persistent Organizer/Admin/Team management token in QR;
- no client-only membership authorization;
- no reusable forever join code.

## Acceptance required before implementation

Confirmed and no longer open:
- Field Group normally ends manually with the tour;
- Room Code/QR and still-open group expire after a hard maximum of 24 hours;
- participant count can be updated during the tour and must be finalized when ending it.

Still required before D1 schema/routes are implemented:
1. confirm final code alphabet/length if the proposed 10-character human-safe Base32 format changes;
2. define credential rotation/revocation UX within the fixed 24-hour group lifetime;
3. define membership/session relationship to current Campaign sessions;
4. define exact server-side authorization matrix for temporary group members;
5. add rate-limit binding configuration and brute-force/revocation/expiry tests;
6. define minimal audit events without logging join secrets.

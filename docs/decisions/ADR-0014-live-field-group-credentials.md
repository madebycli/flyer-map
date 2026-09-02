---
id: ADR-0014
type: decision
status: accepted
date: 2026-08-27
---

# ADR-0014: Live Field Group lifecycle, discovery and temporary join credentials

## Status

Accepted on 2026-08-27 for the first feature-complete Field Group runtime.

This ADR authorizes the additive D1 schema, Worker routes, scoped temporary sessions, credential rotation/revocation and join-rate-limit runtime described below. It does not authorize Organization account/role-template runtime from ADR-0015/ADR-0016 and does not authorize durable Field Session/Event history governed by ADR-0017.

## Context

Plan 012 and Plan 017 separate persistent Teams from temporary Field Groups used during one outing. Temporary join material must never silently grant persistent Team, Campaign Admin or Organization authority.

Current boundaries remain:
- Worker authorization is authoritative;
- ids are selectors, never credentials;
- M5 mutation/idempotency handling remains the concurrency baseline for offline-relevant field mutations;
- no public internet directory of active groups;
- no continuous GPS surveillance;
- no persistent Admin/Team access token may be embedded in a Field Group QR;
- existing Campaign access links remain a separate legacy credential model during this slice.

## Accepted product model

A Field Group belongs to exactly one Campaign/action and one persistent Team.

When a group is created:
- it receives one active human Room Code and one separate active QR join token;
- `online anzeigen` defaults to enabled;
- an authorized manager may disable discoverability without revoking direct joining;
- the group is intended for one short field tour, commonly around 2 to 3 hours;
- it is normally closed manually when the tour ends;
- closing immediately prevents new joins;
- any still-active group expires after a hard maximum of 24 hours from its original creation time.

Participant count is operational tour data, not credential data:
- it may be entered or changed while the group is active;
- the final participant count is mandatory for manual close;
- it never changes authorization scope.

## Lifecycle

Accepted states:
- `active`: group operations and joining are allowed according to authorization and credential state;
- `closed`: manually ended, no new joins, temporary group sessions become unauthorized immediately;
- `expired`: server-enforced hard expiry when the original 24-hour lifetime is reached.

The hard expiry is calculated from the original `created_at` and is immutable. Credential rotation, discoverability changes, participant updates and reconnects never extend it.

Every relevant group read, management operation, join redemption and temporary-session authorization resolves expiry server-side first. A stale client cannot keep a group authorized after the hard expiry.

## Discoverability

Discovery is Campaign-scoped only.

Accepted behavior:
- default filter is `Alle in der Aktion`;
- optional Team filter narrows the already-authorized Campaign result;
- only `active` and `discoverable = true` groups appear;
- `discoverable = false` groups remain joinable by a currently valid direct Room Code or QR token;
- discovery never returns Room Codes, QR tokens, credential hashes, session secrets or exact participant device/location data.

Discovery may expose only fields needed to choose a group, including:
- group id and label;
- Team id/name/color;
- state and join availability;
- participant/progress summary where already authorized and product-relevant.

## Human Room Code

The first runtime uses exactly 10 characters from this human-safe 32-character alphabet:

`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`

Rules:
- generated from cryptographically secure random bytes;
- never sequential and never derived from group, Team or Campaign ids;
- canonical server representation is uppercase without separators;
- user input may be case-insensitive and may contain visual spaces/hyphens that are removed before validation;
- 10 Base32 characters provide 50 bits of random code space before online throttling;
- only a one-way SHA-256 lookup hash is persisted, never plaintext;
- plaintext is returned only on initial issuance or explicit rotation;
- it becomes invalid immediately when revoked/rotated/closed and no later than the group hard expiry.

## QR join token

QR uses a separate opaque token, never the Room Code and never an existing Campaign/Admin credential.

The first runtime uses 32 cryptographically random bytes encoded as base64url, providing 256 bits of random material.

Rules:
- server persists only a SHA-256 lookup hash;
- the QR representation may include the non-secret Campaign id plus the opaque token so a fresh device can reach the correct Campaign join route;
- redemption creates membership/session state, the QR token itself is never the continuing authorization credential;
- it is subject to the same revoke/rotate/close/hard-expiry boundary as the Room Code.

## Credential rotation and revocation UX

A Field Group has one active Room Code credential and one active QR credential pair at a time.

### Rotate

An authorized group manager may explicitly rotate credentials while the group is still active and unexpired.

Rotation:
- atomically revokes the currently active Room Code and QR credential records;
- issues a new Room Code and a new QR token;
- returns both plaintext values once to the manager UI;
- immediately makes old code/QR material unusable for new joins;
- does not remove already active memberships;
- never changes `hard_expires_at`.

The UI must require an explicit action, explain that old join material stops working, then replace the displayed credential pair with the newly issued pair.

### Revoke without close

An authorized manager may revoke the active credential pair without closing the group. Existing memberships remain, but new joins fail until credentials are rotated again. Revocation never extends group lifetime.

### Close

Manual close revokes joinability regardless of individual credential rows and immediately invalidates temporary Field Group authorization for subsequent privileged Worker requests.

## Membership and session relationship

Successful redemption always creates explicit Field Group membership.

Two cases are intentionally separate.

### Existing valid Campaign access

If the browser already has valid Campaign access:
- membership records the existing Campaign grant identity;
- no second more privileged Campaign identity is created;
- the existing Campaign role remains the authorization ceiling;
- joining a group never upgrades a Viewer to editor rights and never expands a Team Editor to another Team;
- normal `vf_session` remains the Campaign session credential.

### No valid Campaign access

A successful valid Room Code/QR redemption may create a separate temporary Field Group session:
- membership is bound to exactly one group, Campaign and Team;
- Worker issues an independent high-entropy HttpOnly Secure SameSite=Lax cookie named `vf_field_group_session`;
- only the session hash is stored server-side;
- session expiry is the group hard expiry, never a sliding 24-hour period from join time;
- leaving, manager removal, group close, credential-independent membership revocation or hard expiry immediately makes subsequent privileged requests unauthorized;
- no persistent `campaign_access_grants` row is created for this temporary participant.

When both a normal Campaign session and a temporary Field Group session are present, normal Campaign access is resolved independently and is never silently replaced or elevated by the temporary session.

## Exact temporary authorization matrix

Temporary Field Group membership is intentionally narrower than persistent Team Member/legacy Team Editor authority.

A valid temporary Field Group member may:
- read the Campaign map data required for its target Team;
- read its Field Group state;
- update ordinary Street/House task status in the target Team through reviewed typed M5 mutations;
- update/leave its own group membership where the operation is supported;
- use already-authorized offline field status work through the M5 queue, subject to server validation on reconnect.

A temporary Field Group member may not:
- create, rename, recolor, archive or delete Teams;
- create, edit, reassign or delete Areas;
- create/delete Street or House tasks;
- change task geometry, source identity/provenance or labels;
- manage access links, invites or persistent memberships;
- manage group discoverability, participant count, credentials, other members or close a group unless a separate persistent Campaign role already grants that management authority;
- change Campaign settings;
- gain Organization Organizer/Admin rights;
- use legacy full-snapshot PUT as a write path.

Temporary task-status authorization resolves canonical Task -> Area -> Team data server-side. Caller-supplied Team ids never establish ownership.

For an existing Campaign session that joins a group, the existing Campaign role remains decisive. Group membership does not add capabilities above that role.

## Group management authorization for the current legacy Campaign model

Until accepted ADR-0015/ADR-0016 runtime replaces the legacy Campaign roles:
- legacy `admin` may create/manage Field Groups for any Team in its Campaign;
- legacy `team-editor` may create/manage Field Groups only for its canonical scoped Team;
- legacy `viewer` may discover/join where otherwise allowed but receives no new persistent editing authority;
- temporary Field Group members cannot manage the group.

This is a migration-time mapping, not the final Organization capability model.

## Join rate limiting and abuse controls

Join redemption is an online-only Worker boundary and fails closed if required rate-limit bindings are unavailable.

The first runtime uses two Cloudflare Workers Rate Limiting bindings:
- actor route limit: 30 join attempts per 60 seconds for a key derived from Campaign id plus Cloudflare connecting IP;
- credential candidate limit: 8 attempts per 60 seconds for a key derived from Campaign id plus the SHA-256 hash of the canonical candidate credential.

The connecting IP is used only as an in-memory Rate Limiting binding key. Application code must not persist it or include it in Field Group audit logs.

Both Room Code and QR redemption pass through the actor limiter. Candidate throttling is additionally applied before accepting the credential. Rate limiting is defense in depth, not a substitute for entropy.

Join responses use generic invalid/unavailable wording so callers cannot distinguish unknown, revoked, rotated, closed or expired credentials. A rate-limited response may use HTTP 429 without disclosing whether the candidate credential exists.

Other controls:
- bounded request bodies and strict schema validation;
- same-origin policy for browser writes where applicable;
- server-side group/membership/credential revocation checks;
- Campaign id is a selector and may be present in the route/QR URL, but never acts as authority;
- no credential/token/hash is logged.

## Minimal audit contract

This slice defines secret-free security/operations audit events without creating the broader durable product Event/Field Session model blocked by ADR-0017.

Event kinds:
- `field_group.created`;
- `field_group.discoverability_changed`;
- `field_group.participant_count_changed`;
- `field_group.credentials_rotated`;
- `field_group.credentials_revoked`;
- `field_group.joined`;
- `field_group.member_left`;
- `field_group.member_removed`;
- `field_group.closed`;
- `field_group.expired`;
- `field_group.join_rate_limited`.

Allowed audit fields are limited to safe identifiers/state such as Campaign id, group id, membership id, Team id, actor kind/grant id when already known, state transition and timestamp.

Forbidden audit/log fields include:
- Room Code plaintext;
- QR token plaintext;
- credential hashes;
- temporary session secrets/hashes;
- Campaign access tokens/session cookies;
- request IP addresses;
- optional future group passwords.

For this slice these events may be emitted as structured Worker security logs. Durable D1 product Activity/Field Session/Event history waits for ADR-0017.

## Offline behavior

A new join always requires online Worker redemption.

A previously authorized temporary participant may continue local task-status work while offline through M5 when the mutation type is in the allowed temporary matrix. On reconnect every queued privileged mutation is authorized again against current server membership/group state.

If membership was removed, the group closed, credentials/session were revoked where relevant, or hard expiry was reached, privileged queue synchronization stops visibly instead of retrying as if still authorized.

## Optional group password

A separate group password is not required for the first feature-complete slice.

If added later:
- it is an additional factor, not a replacement for random Room Code/QR material;
- plaintext is never stored/logged;
- hashing must reuse an accepted password credential design;
- online attempt limits remain mandatory.

## Security non-goals

- no public group directory;
- no GPS route tracking;
- no permanent device fingerprint;
- no persistent Organizer/Admin/Team-management token in QR;
- no client-only membership authorization;
- no reusable forever join code;
- no Organization account/permission runtime hidden inside this slice.

## Consequences

### Positive

- Field Group joining is a real server-side authentication/bootstrap boundary;
- temporary users do not become persistent Team Editors;
- credential rotation cannot accidentally extend tour lifetime;
- Room Code and QR compromise are independently rotatable but share one hard group lifetime;
- discovery remains useful without leaking join material;
- offline task-status work can reuse M5 while reconnect authorization remains authoritative.

### Costs

- Worker gains a second scoped session type and must resolve it carefully alongside legacy Campaign sessions;
- join flow requires Cloudflare Rate Limiting bindings and explicit negative tests;
- client must distinguish Campaign role, group membership and temporary-session state rather than treating every joined device as `team-editor`;
- durable Field Session/Event history still requires ADR-0017 acceptance.

## Required implementation tests

Before FC1 is called feature complete, tests must cover at minimum:
- Room Code alphabet/length/random generation and canonicalization;
- QR token entropy/format;
- plaintext credential values are not stored;
- create authorization for Admin vs own-Team Editor vs foreign Team/Viewer;
- Campaign/Team negative scope checks;
- generic invalid/revoked/rotated/closed/expired join failures;
- actor and candidate rate limits, including fail-closed missing binding behavior;
- rotation immediately invalidates old credentials and preserves original hard expiry;
- close immediately blocks new joins;
- hard 24-hour expiry is server-enforced;
- existing Campaign Viewer is not elevated by joining;
- temporary member cannot manage Team/Area/access/group administration;
- temporary member can change only allowed target-Team task statuses through typed mutation paths;
- temporary member cannot use full-snapshot writes;
- membership remove/leave/close/expiry revokes temporary privileged requests;
- no secrets or IP addresses in structured audit payloads;
- discovery responses contain no join credential material.

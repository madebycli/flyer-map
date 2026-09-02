---
id: architecture-live-teams
type: architecture
status: accepted
last_updated: 2026-08-27
related: [product-roadmap, architecture-security, architecture-data, architecture-identity-permissions, architecture-collaboration, plan-012-platform-app-expansion, ADR-0014, ADR-0017]
source_of_truth_for: [live-field-groups, team-qr-codes, team-join-codes, live-group-discoverability, temporary-group-memberships]
---

# Live Field Groups and Multi-Device Joining

## Purpose

Define the accepted runtime boundary for temporary Field Groups used during one distribution or collection outing.

The feature-complete FC1 runtime lives on the current Plan-017 branch. ADR-0014 governs credentials, membership and temporary authorization. ADR-0017 governs the durable Field Session created when a group closes or expires.

## Persistent Team vs temporary Field Group

These remain separate concepts.

### Team

A persistent colored Campaign group with Areas, metadata and long-lived access policy.

### Field Group / Einsatzgruppe

A temporary active working group inside exactly one Team for one outing/tour.

Joining a Field Group never creates a persistent Team credential, never grants Admin authority and never widens an existing Campaign role.

## Accepted lifecycle

A Field Group uses:
- `active`;
- `closed`;
- `expired`.

Rules:
- one Field Group represents one tour;
- normal tours are expected to be roughly 2 to 3 hours, but this is not a normal-duration limit;
- normal end is explicit manual close;
- close immediately blocks new joins and invalidates temporary privileged access;
- forgotten active groups expire no later than 24 hours from original creation;
- credential rotation/revocation never extends the original hard expiry;
- every relevant read, join and authorization path resolves server-side expiry.

## Participant count

Participant count is explicit operational data, not identity or authorization.

Rules:
- optional while the tour is active;
- positive integer from 1 through 500 when present;
- final participant count is mandatory for normal manual close;
- it feeds Field Session person-time;
- expiry may preserve an unknown participant count rather than inventing one;
- no GPS trail is used to derive participants or duration.

## Discoverability

Discovery is Campaign-scoped only.

Accepted behavior:
- new groups are discoverable by default;
- an authorized manager may disable discoverability without revoking direct join material;
- normal discovery returns only active discoverable groups;
- Team filter can narrow, never widen, Campaign scope;
- discovery never returns Room Codes, QR tokens, hashes, session secrets or device/IP data.

## Join credentials

ADR-0014 accepts two independent credential kinds.

### Room Code

- 10 characters;
- human-safe Base32 alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`;
- cryptographically random;
- canonical uppercase input, visual spaces/hyphens may be normalized;
- D1 stores SHA-256 lookup hash only;
- plaintext returned only on issuance/rotation.

### QR token

- separate 32-byte cryptographically random token;
- base64url representation;
- not the Room Code and not a Campaign/Admin access token;
- D1 stores SHA-256 lookup hash only;
- QR redemption creates membership/session state rather than trusting the token forever.

An optional additional group password is not part of FC1 and is not required for feature completion.

## Rotation and revoke

Authorized managers may:
- rotate both active credentials atomically;
- revoke join credentials without closing the group;
- close the group;
- remove an active membership.

Rotation:
- invalidates old join material immediately;
- issues new Room Code and QR material once;
- preserves existing memberships;
- never changes `hard_expires_at`.

Revoke without close blocks new joins while existing memberships remain active.

## Membership and authorization

Successful join always creates an explicit membership.

### Existing Campaign access

If a browser already has valid Campaign access:
- membership references the existing Campaign grant;
- no second more privileged identity is created;
- existing role remains the authorization ceiling;
- Viewer is not elevated by joining;
- Team Editor scope is not widened by joining.

### Temporary participant

A user without persistent Campaign access may receive `vf_field_group_session`:
- opaque high-entropy cookie;
- HttpOnly, Secure, SameSite=Lax;
- D1 stores only its hash;
- scoped to one Campaign, Team and Field Group;
- expires no later than group hard expiry;
- leave, manager removal, close or expiry revokes subsequent privileged requests.

Temporary members may read the required target-Team map context and submit reviewed typed Street/House status mutations for that Team. They may not manage Teams, Areas, Task identity/geometry, access links, group credentials, other members, Campaign settings or Admin/Organization functions.

## Manager authorization during the legacy Campaign-role phase

Until future Organization/capability runtime replaces legacy roles:
- `admin` manages any group in the Campaign;
- `team-editor` manages only groups for its canonical scoped Team;
- `viewer` may discover/join but receives no management rights;
- temporary members cannot manage the group.

Worker authorization remains authoritative. Client Team ids and membership ids are selectors only.

## Manager member roster

FC1 exposes a server-authorized active-member roster only to group managers.

The roster returns minimum operational metadata:
- membership id;
- membership kind: existing Campaign access or temporary;
- safe display label when available;
- joined timestamp.

It never exposes:
- temporary session hash/secret;
- Campaign session/access secret;
- Room Code or QR token/hash;
- connecting IP;
- device fingerprint.

Removing a membership is an explicit destructive action. Temporary authorization becomes invalid on the next protected request after removal.

## Join abuse protection

Join redemption is online-only and fail-closed when rate-limit bindings are unavailable.

Current Cloudflare limits:
- actor key: 30 attempts per 60 seconds per Campaign plus connecting IP;
- candidate key: 8 attempts per 60 seconds per Campaign plus canonical candidate hash.

The connecting IP is used only as a rate-limit key and is not persisted or included in product audit/history.

Join failures use generic unavailable wording so unknown/revoked/rotated/closed/expired credentials are not distinguishable through normal responses.

## Multi-device and offline behavior

Multiple devices in one Field Group share authoritative Campaign/Team progress through existing APIs and M5 mutation synchronization.

Rules:
- new join always requires online Worker redemption;
- no WebSocket, Service Worker or Background Sync requirement is introduced;
- already authorized temporary participants may queue permitted status work through M5 while offline;
- every reconnect mutation is re-authorized against current membership/group state;
- removed/closed/expired access becomes visibly blocked instead of retrying forever.

## Field Session relationship

ADR-0017 is accepted.

`migrations/0007_field_sessions_events.sql` provides the first durable relationship:
- deterministic one-to-one Field Session for a Field Group end state;
- manual close stores duration, final participants and person-time;
- safety expiry stores duration and preserves participant/person-time as unknown when they were never explicitly supplied;
- deduplicated `field_session.closed` or `field_session.expired` event;
- no continuous route/GPS history.

Broader session history reads, Task-event attribution, notes, comments and Activity are FC2 work.

## Privacy and security non-goals

Do not add:
- public group directory;
- continuous GPS upload or route history;
- permanent hardware/device fingerprinting;
- persistent Admin/Team credential in QR;
- client-only authorization;
- reusable forever join code.

## Rollout status

The runtime code and migrations are prepared on Draft PR #72, but migrations 0006 and 0007 are not recorded as remotely applied. Production D1 rollout remains a separate explicit operation.

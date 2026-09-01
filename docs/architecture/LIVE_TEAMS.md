---
id: architecture-live-teams
type: architecture
status: proposed
last_updated: 2026-08-26
related: [product-roadmap, architecture-security, architecture-data, architecture-identity-permissions, architecture-collaboration, plan-012-platform-app-expansion]
source_of_truth_for: [future-live-field-groups, future-team-qr-codes, future-team-join-codes, future-team-live-discoverability]
---

# Live Field Groups and Multi-Device Joining - Proposed

## Purpose

Define the future model for temporary groups that are actively distributing/collecting and can be joined from multiple devices.

Credential and membership runtime is not yet implemented.

## Persistent Team vs temporary Field Group

Keep two concepts separate:

### Team
Persistent colored Campaign group with Areas, metadata, permissions and long-lived access policy.

### Field Group / Einsatzgruppe
Temporary active working group inside one Team for exactly one outing/tour.

A Field Group must never silently become a permanent Team credential or admin role.

## Confirmed tour lifecycle

The product lifecycle is already confirmed even though ADR-0014 remains proposed overall:
- one Field Group represents one tour;
- a normal tour is expected to last roughly 2 to 3 hours, but this is not a hardcoded normal-duration limit;
- the normal end is an explicit manual close;
- manual close makes the group non-joinable immediately and future Room-Code/QR redemption must fail;
- if a group is forgotten, an active group expires no later than 24 hours after its original creation;
- `expired` is the safety fallback, not the normal workflow;
- credential rotation/replacement must never move the Field Group hard expiry beyond that original 24-hour maximum.

Workbench/domain code may model `active`, `closed` and `expired` plus the derived hard-expiry timestamp without implementing any credential, membership or authorization runtime.

## Participant count

Participant count is explicit operational data:
- it may be entered or corrected while the tour is active;
- the final participant count must exist before the normal manual close succeeds;
- it feeds Field Session duration/person-time/statistics;
- it never grants access, changes permissions or acts as a credential;
- no participant GPS trail is needed to calculate it.

The current Workbench bounds the count to a positive integer from 1 through 500, matching the existing Field Session metrics validation. This is a defensive application bound, not an authorization rule.

## Discoverability

Confirmed default:
- new Field Groups are discoverable by default;
- creator/authorized manager may opt out;
- discoverability is only inside the current Campaign/action context;
- there is no public internet directory of active groups;
- only active discoverable groups belong in normal discovery lists, closed/expired groups do not.

A Team filter narrows the current Campaign list and must never widen scope.

## Joining

Candidate join methods:
- QR code;
- short human-enterable group code;
- optional additional group password.

Security requirements:
- codes are random/non-sequential;
- short enough for humans but protected against brute force with rate limiting and expiry;
- QR contains only the minimum join material;
- temporary join credentials expire/revoke;
- do not expose persistent Admin or Team access tokens through a QR intended only for a Field Group;
- optional password is hashed/verified safely and never stored in plaintext;
- successful join returns scoped server-side session/member state rather than trusting the code forever;
- a credential cannot be used to extend the Field Group beyond its original 24-hour hard expiry.

Exact credential format, rotation/revocation behavior, rate limits and membership/session relationship remain under ADR-0014.

## Multi-device collaboration

Multiple devices in one Field Group may:
- see the same Team/Field Group identity;
- see shared current progress;
- create authorized Task mutations;
- contribute to one Field Session;
- see relevant synchronization/conflict state.

Concurrent mutation behavior must reuse the M5 durable mutation/conflict architecture rather than adding last-write-wins shortcuts.

## Presence

Avoid invasive presence tracking.

Allowed direction:
- active/closed/expired Field Group state;
- explicit participant count for the tour;
- optional count of active joined devices where useful and separately defined;
- last activity time where operationally justified.

Participant count and joined-device count are not interchangeable.

Do not require:
- continuous GPS upload;
- exact live movement trails;
- permanent hardware/device fingerprinting.

## Field Session relationship

A Field Group normally maps to or participates in a Field Session.

Session may collect:
- date;
- duration;
- final participant count;
- optional note;
- Task events/changes;
- distribution or collection mode;
- derived person-time.

The Workbench may derive a local session summary at manual close. Durable event/session persistence remains governed by ADR-0017 and later server-side authorization design.

## Team-specific invites

The current generic Campaign access links must later be redesigned.

Future separation:
- Organization/Admin account invitations;
- persistent Campaign/Team access invitations;
- temporary Field Group join QR/code/password.

These credentials have different scopes and lifetimes and must not reuse one ambiguous token type.

## Revocation

Administrators/authorized Team managers need to be able to:
- close a Field Group;
- rotate/disable join credentials without extending the 24-hour group deadline;
- remove a joined participant if policy allows;
- disable discoverability;
- revoke persistent Team access separately.

Revocation must be checked server-side.

## Abuse protection

Join endpoints require:
- request size/schema validation;
- rate limiting;
- expiry checks;
- constant-time secret/password comparison where applicable;
- no useful enumeration of valid group codes beyond successful authorized join;
- audit/activity events for sensitive join-policy changes where appropriate;
- no credential or QR secret in normal logs.

## UI direction

The mobile app menu contains Teams / Join Team.

Possible views:
- current Team and Field Group;
- live discoverable Field Groups;
- join via code;
- scan/show QR;
- current group progress;
- participant count while active;
- manual tour close according to permissions.

The active Team name and compact progress remain visible near the top-bar Menu control while working.

## ADR gates before credential implementation

ADR-0014 already records the confirmed manual-close + hard-24-hour lifecycle and participant-count behavior.

Before building real join credentials or membership persistence, still define/accept:
- final code/QR credential format where proposals change;
- credential rotation/revocation UX inside the fixed group lifetime;
- exact temporary Field Group capability matrix;
- relationship to existing Campaign sessions and future account sessions;
- rate-limit configuration and brute-force/revocation/expiry tests;
- minimal audit events without secrets;
- offline behavior for previously joined devices after server-side revocation/expiry.

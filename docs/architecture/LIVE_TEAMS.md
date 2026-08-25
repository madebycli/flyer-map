---
id: architecture-live-teams
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-security, architecture-data, architecture-identity-permissions, architecture-collaboration, plan-012-platform-app-expansion]
source_of_truth_for: [future-live-field-groups, future-team-qr-codes, future-team-join-codes, future-team-live-discoverability]
---

# Live Field Groups and Multi-Device Joining — Proposed

## Purpose

Define the future model for temporary groups that are actively distributing/collecting and can be joined from multiple devices.

This is not yet implemented.

## Persistent Team vs temporary Field Group

Keep two concepts separate:

### Team
Persistent colored Campaign group with Areas, metadata, permissions and long-lived access policy.

### Field Group / Einsatzgruppe
Temporary active working group inside one Team for one outing/session.

A Field Group must never silently become a permanent Team credential or admin role.

## Discoverability

Requested default:
- new Field Groups are discoverable by default;
- creator may opt out;
- discoverability is only inside the authorized Campaign context;
- there is no public internet directory of active groups.

The exact audience requires an ADR, but must be limited to callers already authorized to access the Campaign or Organization context according to policy.

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
- successful join returns normal scoped session/member state rather than trusting the code forever.

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
- active/inactive Field Group state;
- optional count of active joined participants/devices where useful;
- last activity time where operationally justified.

Do not require:
- continuous GPS upload;
- exact live movement trails;
- permanent hardware/device fingerprinting.

## Field Session relationship

A Field Group normally maps to or participates in a Field Session.

Session may collect:
- date;
- duration;
- participant count;
- optional note;
- Task events/changes;
- distribution or collection mode.

The exact session lifecycle requires schema/event design in M7.

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
- rotate/disable join credentials;
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
- audit/activity events for sensitive join-policy changes where appropriate.

## UI direction

The mobile app menu contains Teams / Join Team.

Possible views:
- current Team and Field Group;
- live discoverable Field Groups;
- join via code;
- scan/show QR;
- current group progress;
- leave/close group according to permissions.

The active Team name and compact progress remain visible near the top-bar Menu control while working.

## ADR required before implementation

Before building join credentials, accept an ADR defining:
- Field Group lifecycle;
- discoverability audience;
- code entropy/length/expiry;
- QR payload;
- password semantics;
- membership/session schema;
- rate limiting;
- revocation;
- relationship to Team access and Field Sessions;
- offline behavior when a device already joined before losing connectivity.

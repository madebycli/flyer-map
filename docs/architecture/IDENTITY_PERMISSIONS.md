---
id: architecture-identity-permissions
type: architecture
status: proposed
last_updated: 2026-08-25
related: [architecture-organizations, architecture-security, architecture-data, product-roadmap, plan-012-platform-app-expansion]
source_of_truth_for: [future-admin-accounts, future-totp, future-permission-model, future-admin-transfer]
---

# Identity, Administrator Accounts and Permissions — Proposed

## Purpose

Define security boundaries for the future account-based Organization/Admin system and configurable permissions.

This document is proposed. It does not change the current Campaign Admin / Team Editor / Viewer model by itself.

## Requested administrator identity model

Future Organization administrators should be able to use:
- username;
- password;
- authenticator-app TOTP as second factor;
- no SMS requirement;
- no mandatory email identity.

Multiple administrator accounts must be supported. Administration cannot depend on one original owner or one shared password.

## Authentication is not authorization

A valid account/session only proves identity.

Every privileged Worker route must still evaluate:
- Organization membership;
- Campaign scope where relevant;
- effective capabilities;
- resource ownership/scope;
- revocation state.

No client-side menu, hidden button or route guard is an authorization boundary.

## Injection and input handling

All account and admin inputs are untrusted data.

Mandatory:
- never concatenate username/password/TOTP/form input into SQL;
- use D1 prepared/parameterized queries;
- never evaluate user input as JavaScript, HTML, SQL, shell commands or template code;
- safely encode output;
- prefer a restrictive Content Security Policy;
- validation rejects structurally invalid data but security must never rely only on input blacklists.

An attacker typing SQL, HTML or script-like text into username/password fields must only create inert input bytes, never executable syntax.

## Password storage

Raw passwords must never be persisted or logged.

Before implementation, an ADR must choose a reviewed password hashing design compatible with the Worker runtime.

Requirements:
- unique salt per credential;
- appropriate work/memory cost;
- constant-time verification where supported by the chosen library/runtime;
- algorithm/version metadata to allow future rehashing;
- no home-grown password cryptography.

## TOTP

TOTP is the requested second factor.

Requirements:
- TOTP secret generated from cryptographically secure randomness;
- secret displayed only during enrollment/recovery workflows that require it;
- secret protected at rest according to the accepted ADR;
- server-side validation;
- narrow clock-step tolerance;
- rate limiting;
- avoid accepting the same code repeatedly in the same time window where feasible;
- secrets/codes never logged;
- recovery/reset is a privileged audited operation.

## Sessions

Account sessions must remain revocable server-side.

Requirements:
- opaque high-entropy session secret;
- only a hash/derived representation persisted server-side;
- Secure + HttpOnly + appropriate SameSite cookie;
- session rotation on successful login and security-sensitive changes where appropriate;
- explicit logout/revocation;
- authorization re-checks membership/capabilities rather than trusting stale browser claims indefinitely.

## Abuse protections

Authentication endpoints require:
- rate limiting / throttling;
- generic failure messages that do not unnecessarily disclose whether a username exists;
- monitoring/audit signals for repeated failures;
- bounded request sizes;
- CSRF/Origin protection for authenticated state changes.

The exact Cloudflare rate-limit mechanism must be selected in the implementation ADR/plan.

## Multiple admins and transfer

The Organization model must support multiple administrators.

Safety rules:
- never allow accidental removal of the last effective Organization Admin without an explicit safe transfer/recovery path;
- adding/removing Admin capability is audited;
- admin transfer must not require sharing a password/TOTP secret;
- recovery must not reintroduce first-visitor or race-to-claim ownership.

## Capability model

Future permissions should be explicit capabilities rather than ad-hoc UI booleans.

Candidate capabilities include:
- Team create/rename/color/archive-delete;
- Area create/edit/delete with own-Team vs other-Team distinctions;
- Task edit/delete with own-Team vs other-Team distinctions;
- Team invite management;
- live Field Group create/manage/discoverability;
- comments and moderation;
- statistics viewing;
- Campaign settings;
- permission management;
- administrator management.

## Policy direction

Exact semantics require an ADR, but the design should prefer:
- named role templates for understandable common cases;
- explicit capability evaluation;
- optional overrides only if needed;
- deny-by-default;
- Organization boundary cannot be overridden;
- server-side tests for every capability family;
- effective permissions inspectable in Admin UI.

Avoid a giant matrix where arbitrary combinations become impossible to audit.

## Team deletion/archive

Team archive/delete is a privileged capability.

Before implementation decide:
- archive vs permanent delete;
- handling of Areas, Tasks, sessions, comments, invites and historical statistics;
- whether historical records retain a tombstoned Team identity;
- who may restore archived Teams;
- how grants scoped to a deleted Team become invalid.

## Audit requirements

At minimum record meaningful events for:
- account created/disabled;
- admin added/removed;
- permission/role changed;
- TOTP enrolled/reset;
- sensitive recovery action;
- Team archived/deleted;
- invite/access policy changed.

Audit data must remain tenant-scoped and must not expose secrets.

## ADR required before implementation

Do not implement account tables/login/TOTP/permission writes until an accepted ADR defines:
- credential hashing algorithm/library/runtime strategy;
- TOTP secret-at-rest approach;
- account/session schema;
- session expiry/rotation;
- login rate limiting;
- recovery strategy;
- role template + capability evaluation;
- legacy Campaign Admin migration/interaction;
- audit retention.

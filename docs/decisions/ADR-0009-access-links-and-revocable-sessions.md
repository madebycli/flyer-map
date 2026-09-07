---
id: ADR-0009
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0009: Use revocable access links with Worker-enforced sessions

## Context

M3 made Campaign snapshots shared through Cloudflare Worker + D1, but Campaign knowledge was effectively sufficient to reach the shared endpoints. M4 must protect Campaign data without introducing classic user accounts, email/password or OAuth.

The current M3 write API replaces a complete Campaign snapshot. That is compatible with an Admin, but a team-scoped editor must not be able to smuggle changes to Campaign settings, teams or another team's Areas/Tasks inside the same payload.

Existing M3 Campaigns also predate owner credentials. Letting the first visitor claim Admin would create an unsafe ownership race.

## Decision

Use Campaign-scoped access grants with the roles `admin`, `team-editor` and `viewer`.

Each grant contains an independent cryptographically random invite token. D1 stores only SHA-256 token hashes, never plaintext invite tokens. Team Editor grants require a Campaign-local Team scope; Admin and Viewer grants have no Team scope.

Invite links carry the token only in the URL fragment. The browser sends the fragment token once to the Worker redemption endpoint, then removes it from the visible URL. Successful redemption creates a new opaque random session secret in a `Secure; HttpOnly; SameSite=Lax` cookie. D1 stores only the session hash.

At application startup, the campaign store is the single client-side source of truth for this access transition. It marks access as pending while redeeming a fragment, and the operator recovery UI may appear only after the store reports that access is required. A pre-redemption 401 therefore cannot race the valid Access-Link redemption into an operator-recovery screen.

Every protected request resolves the session and its backing grant again. A revoked grant therefore invalidates already-issued sessions immediately; revocation is not merely an invite-link disable switch.

`campaignId` remains a selector only. Snapshot and revision endpoints return authorization errors without a valid Campaign-scoped credential.

For M4, keep complete-snapshot PUTs. Admin can replace a valid Campaign snapshot. Viewer writes are rejected. For Team Editor, the Worker loads the previous snapshot and compares it with the proposed snapshot before persistence. The Worker permits only changes to Areas owned by the scoped Team and Tasks belonging to those Areas, while rejecting Campaign settings, Teams, foreign Areas/Tasks and ownership reassignment.

Pre-M4 Campaigns can receive their first Admin grant only through an explicit Worker bootstrap endpoint protected by a deployment secret. Bootstrap is allowed only while the Campaign has zero grants. There is no first-visitor or campaign-id-only claim flow.

## Permission matrix

| Capability | Admin | Team Editor | Viewer |
| --- | --- | --- | --- |
| Read Campaign snapshot/version | yes | yes | yes |
| Rename/configure Campaign | yes | no | no |
| Set/remove Campaign map focus | yes | no | no |
| Manage Teams | yes | no | no |
| Create/edit/delete own scoped Areas | yes | yes | no |
| Reassign Area to another Team | yes | no | no |
| Create/edit/delete Tasks in own scoped Areas | yes | yes | no |
| Change status in own scoped Areas | yes | yes | no |
| Modify another Team's Areas/Tasks | yes | no | no |
| Create/revoke Access Links | yes | no | no |

## Consequences

Positive:
- no personal identity data is required for the MVP;
- leaked or obsolete invite links can be revoked;
- revocation also terminates their sessions on the next protected request;
- the Worker, not React button visibility, is the authorization boundary;
- Team Editor remains safe despite the M3 complete-snapshot protocol;
- M3 Campaign ownership is bootstrapped explicitly instead of by race.

Tradeoffs:
- one browser session cookie currently represents one active Campaign access session at a time;
- complete-snapshot diff authorization is more complex than future mutation-specific endpoints;
- a deployment bootstrap secret is an intentional one-time operational dependency for existing M3 Campaigns;
- M5 may replace snapshot writes with a durable mutation queue and narrower mutation endpoints.

## Security notes

Access tokens and session secrets are bearer credentials. They must never be committed, logged intentionally or persisted in D1 as plaintext. Admin UI shows a newly created invite link only at creation time because the plaintext token cannot be reconstructed from its stored hash.

## Revisit when

Revisit when durable mutation queues or account-backed identity are introduced, or if users need multiple independent Campaign sessions open concurrently in one browser profile.

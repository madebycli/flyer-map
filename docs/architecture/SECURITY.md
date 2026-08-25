---
id: architecture-security
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-data, product, product-roadmap, architecture-organizations, ADR-0009]
source_of_truth_for: [authorization, privacy-baseline, current-access-model]
---

# Security and Privacy

## Baseline

The client is untrusted. Every protected request is authorized and every state-changing payload is validated by the Cloudflare Worker. React/UI visibility is a convenience, never the authorization boundary.

Campaign ids, future Organization ids and domain ids are selectors only. They are never credentials.

## Current Campaign access model

Current roles:
- `admin`;
- `team-editor` scoped to one Team;
- `viewer`.

| Capability | Admin | Team Editor | Viewer |
| --- | --- | --- | --- |
| Read Campaign snapshot/version | yes | yes | yes |
| Campaign settings/map focus | yes | no | no |
| Manage Teams | yes | no | no |
| Create/edit/delete Areas | yes | own Team only | no |
| Create/edit/delete Tasks/status | yes | own Team Areas only | no |
| Modify another Team | yes | no | no |
| Create/revoke Campaign Access Links | yes | no | no |

The Worker enforces scope on every write. Current complete-snapshot Team Editor writes are diff-authorized against the previous server state.

## Access grants and sessions

Access grant token:
- generated from cryptographically strong random bytes;
- plaintext returned only when created;
- D1 stores SHA-256 hash, role/scope/metadata only.

Invite links carry tokens in URL fragments. Browser redeems the fragment and removes it from the URL.

Successful redemption creates a separate opaque session secret in a `Secure; HttpOnly; SameSite=Lax` cookie. D1 stores only its hash.

Every protected request resolves the session's backing grant. Revoking the grant invalidates backed sessions on their next protected request.

## Team Editor scope

Team Editor grant creation verifies that the scoped Team exists. Access resolution also verifies the Team still exists.

There is intentionally no D1 Team foreign key on the grant in the current snapshot-replacement architecture; see `docs/architecture/DATA.md`.

## Existing Campaign bootstrap

Legacy pre-M4 Campaigns are never assigned to the first visitor.

Initial bootstrap requires:
- configured server-only `M4_BOOTSTRAP_SECRET`;
- correct supplied secret;
- existing Campaign;
- zero existing grants for the initial-bootstrap operation.

Campaign id alone never creates ownership.

## Operator Admin recovery

PR #21/current follow-up supports explicit operator recovery when an Admin session/link is lost.

Recovery:
- requires the configured high-entropy server secret;
- verifies Campaign existence;
- may create a fresh normal revocable Admin grant even when grants already exist;
- creates a secure session for the current origin;
- returns the new Admin Access token/link once;
- does not persist the operator secret in browser Campaign state or D1.

This is a privileged operator mechanism, not an ordinary user login system.

## Request protections

- valid session required for protected Campaign routes;
- Viewer writes return authorization failure;
- cross-Campaign credentials fail;
- payloads are size/schema/geometry/ownership validated;
- stale revisions conflict rather than silently overwrite;
- same-origin protections apply to browser state-changing requests when Origin is present;
- secrets are verified server-side only.

## Future Organizations and multiple admins

Multi-organization administration is planned but **not implemented by current Campaign Admin roles**.

Before M8 implementation an ADR must define Organization identity/membership/session behavior.

Mandatory future security properties:
- Organization is a tenant boundary;
- no cross-Organization reads/writes/statistics/comments/activity;
- multiple Organization Admins supported explicitly;
- Campaign Admin is not silently treated as Organization Admin;
- membership/revocation enforced server-side;
- legacy Campaign migration cannot create a first-visitor claim race;
- privileged admin/automation actions have auditable event records where appropriate.

See `docs/architecture/ORGANIZATIONS.md`.

## Comments, activity, automations and statistics

Future collaboration/reporting endpoints must enforce the same server-side scope principles.

Automations must not become a bypass around caller/system authorization. Idempotent automation/domain mutation handling is required before privileged automatic effects are trusted.

Statistics may aggregate authorized state/events, but must not introduce continuous GPS surveillance.

## GPS and camera privacy

The product does not upload/persist continuous device location history.

One-shot browser location may orient the map. Personal center/zoom/bearing is local browser preference and is not shared merely because the map moves.

Shared Campaign focus is configuration, not location tracking.

## Secrets

Never commit or paste into normal project communication:
- Cloudflare API tokens;
- bootstrap/recovery secrets;
- plaintext production Access Links/tokens;
- session secrets;
- private Campaign/Organization exports.

A D1 database id is configuration, not a credential.

## Data minimization

Current Access Grants do not require personal name/email/phone/device identity. Operational labels may be used.

Future Organization identity may require more durable member identity, but only collect data needed for explicit administrative/security requirements. Do not add personal profiling or movement tracking for statistics.

See ADR-0009 for the current Campaign access/session decision.

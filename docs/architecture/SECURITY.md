---
id: architecture-security
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-data, architecture-offline-sync, product, product-roadmap, architecture-organizations, ADR-0009, ADR-0011]
source_of_truth_for: [authorization, privacy-baseline, current-access-model]
---

# Security and Privacy

## Baseline

The client is untrusted. Every protected request is authorized and every state-changing payload is validated by the Cloudflare Worker. React/UI visibility, local queue state and mutation labels are conveniences, never authorization boundaries.

Campaign ids, future Organization ids, domain ids and M5 mutation ids are selectors/identifiers only. They are never credentials.

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
| Submit M5 domain mutations | yes | own authorized scope only | no |

The Worker enforces scope on every write.

During M5 transition:
- legacy snapshot PUT remains diff-authorized against previous server state;
- M5 mutation writes are converted into a current/candidate snapshot in the Worker and passed through the **same existing authorization policy** before D1 persistence.

This prevents a client from bypassing scope by lying about a mutation type or target.

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

There is intentionally no D1 Team foreign key on the grant while the legacy snapshot-replacement compatibility path exists; see `docs/architecture/DATA.md`.

For M5 mutations, Team Editor scope is not inferred from client mutation payload alone. The Worker:
1. loads canonical current snapshot;
2. applies the proposed mutation in memory;
3. validates the candidate snapshot;
4. compares current/candidate through `authorizeSnapshotWrite`;
5. persists only if allowed.

## M5 mutation request security

Protected endpoint:
- `POST /api/campaigns/:campaignId/mutations`.

Controls:
- same-origin write protection applies before route handling;
- valid Campaign session/grant required;
- Viewer rejected before mutation persistence;
- Campaign id in the payload must match the protected route Campaign;
- mutation id/type/base revision/createdAt/payload are schema validated;
- mutation request body is size limited;
- resulting Campaign snapshot is fully validated before persistence;
- existing Worker authorization policy is authoritative;
- D1 revision/write-token claim protects concurrent persistence;
- mutation idempotency ledger prevents duplicate replay effects.

A stable mutation id allows safe retry. It does **not** authorize the retry. Every retry still resolves current access first.

If an already-applied mutation id is replayed, the Worker returns its previous applied revision only after the request has passed the protected route's access resolution. The ledger is not a public lookup service.

## Queue and revocation behavior

IndexedDB queue records may contain domain mutation payloads necessary to retry a user's saved work. They do not contain plaintext Access Link tokens or session secrets.

When a queued request receives 401/403:
- the record remains locally preserved;
- queue state becomes `blocked-auth`;
- ordered automatic retry stops;
- the client must not blindly hammer a revoked credential.

A later valid access session may allow the queue to resume, but the Worker re-authorizes each mutation against current canonical state.

## Existing Campaign bootstrap

Legacy pre-M4 Campaigns are never assigned to the first visitor.

Initial bootstrap requires:
- configured server-only `M4_BOOTSTRAP_SECRET`;
- correct supplied secret;
- existing Campaign;
- zero existing grants for the initial-bootstrap operation.

Campaign id alone never creates ownership.

## Operator Admin recovery

Operator recovery remains available after PR #21 and is unchanged by M5.

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
- target conflicts/revision races do not silently overwrite;
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

M5 mutation ids/idempotency do not establish Organization identity. Future tenant scope must be added explicitly to the authorization/data model.

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

M5 stores only the domain payload and metadata needed to deliver/reconcile queued saved work. It does not add GPS history, device profiling or user tracking.

Future Organization identity may require more durable member identity, but only collect data needed for explicit administrative/security requirements. Do not add personal profiling or movement tracking for statistics.

See ADR-0009 for Campaign access/session and ADR-0011 for durable mutation/idempotency behavior.

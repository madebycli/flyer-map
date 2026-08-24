---
id: architecture-security
type: architecture
status: proposed
last_updated: 2026-08-24
related: [architecture-data, product]
source_of_truth_for: [authorization, privacy-baseline]
---

# Security and Privacy

## Baseline

The client is untrusted. Every state-changing API request must be validated by the Worker. Once authorization exists, it must also be enforced by the Worker rather than only by the UI.

M3 adds shared persistence before the separate M4 access-link/authorization milestone. This is an intentional temporary milestone boundary, not the final security model.

## M3 shared-persistence boundary

The M3 Worker:
- validates the complete snapshot server-side;
- rejects invalid polygon/LineString geometry;
- verifies campaign/team/area/task ownership relationships;
- enforces revision-based optimistic concurrency;
- does not accept direct D1 access from browsers.

M3 does **not** add login, user accounts, invite links, roles or access tokens.

The campaign id in `?campaign=` and the campaign API route is a selector only. It must not be treated as a secret or as proof of authorization.

Before broader shared use, M4 must add Worker-enforced access links/authorization so knowing a campaign id alone is insufficient to read or write it.

## Planned access model — M4

The MVP should prefer revocable invite/access links over mandatory email/password accounts.

Expected roles:
- admin
- team editor
- read-only viewer

Access tokens must:
- contain strong random entropy;
- never be stored in plaintext server-side when hashing is practical;
- be revocable;
- have campaign/role scope.

## GPS

The MVP does not upload or persist continuous device location.

The browser may use location locally to orient the map. No movement history is created by Verteil-Flyer and M3 does not add location data to D1.

## Secrets

Never commit Cloudflare API tokens, D1 credentials, production invite links or private campaign exports.

A real D1 `database_id` is deployment configuration and may appear in `wrangler.jsonc`; it is not a database credential. Never invent a fake one.

Use Cloudflare secrets/variables for future server secrets.

## Data minimization

Do not collect names, email addresses, phone numbers or device identifiers unless a later product requirement demonstrates a concrete need.

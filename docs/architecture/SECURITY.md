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

The client is untrusted. Every state-changing API request must be validated and authorized by the Worker.

## Planned access model

The MVP should prefer revocable invite/access links over mandatory email/password accounts.

Expected roles:
- admin
- team editor
- read-only viewer

Access tokens must:
- contain strong random entropy
- never be stored in plaintext server-side when hashing is practical
- be revocable
- have campaign/role scope

## GPS

The MVP does not upload or persist continuous device location.

The browser may use location locally to orient the map. No movement history is created by Verteil-Flyer.

## Secrets

Never commit Cloudflare API tokens, D1 credentials, production invite links or private campaign exports.

Use Cloudflare secrets/variables for future server secrets.

## Data minimization

Do not collect names, email addresses, phone numbers or device identifiers unless a product requirement later demonstrates a concrete need.

---
id: ADR-0023
type: decision
status: accepted
date: 2026-09-02
---

# ADR-0023: Mission Manual Distribution and Campaign-local Admin Accounts

## Decision

For the 2026-09-02 Distribution mission, the normal Area flow is manual:

- a saved Area does not trigger, queue or poll server-side OSM preparation;
- authorized users create Streets through the global manual-Street action or the selected Area;
- every Street line must remain fully inside the selected Area, enforced in browser validation and by the Worker mutation path;
- the existing automatic-preparation implementation and its historical data remain intact but dormant behind one explicit release policy.

The mission also accepts a deliberately narrow campaign-local Admin account path, separate from the proposed Organization identity model in ADR-0015:

- an existing Campaign Admin creates a one-time, 24-hour setup link;
- the recipient chooses an ASCII username and a password of at least 12 characters;
- D1 stores only PBKDF2-HMAC-SHA-256 verifier material, with a unique 16-byte salt, 600,000 iterations and a 32-byte derived value;
- account sessions are opaque, `HttpOnly`, `Secure`, `SameSite=Lax`, 12-hour cookies whose server rows can be revoked;
- setup tokens and sessions are stored only as SHA-256 hashes;
- durable username-scoped failures lock after five failed attempts for 15 minutes; failure responses remain generic;
- the account maps to a normal Campaign Admin grant, so established Worker authorization remains authoritative.

## Scope and exclusions

This does not accept the Organization model from ADR-0015/ADR-0016. It does not add email identity, TOTP, recovery codes, cross-Campaign accounts, JWTs, a shared password, or a generic capability system. TOTP is explicitly excluded for this mission.

The current Campaign Admin may disable an account. This revokes its account sessions immediately. Revoking the backing Campaign Admin grant also invalidates it on the next protected request.

## Operational order

Migration `0015_mission_campaign_admin_accounts.sql` is additive and must be applied before deploying the Worker code that exposes account endpoints. No application code applies D1 migrations. The existing Access-link and operator-recovery paths remain available for fallback.

## Evidence

The Worker-compatible implementation was locally exercised with the production PBKDF2 setting. The focused test suite verifies one-time setup replay rejection, hash-only storage, canonical username lookup, valid login, generic failure and session resolution. Production acceptance still requires the standard D1 migration and real-device login smoke test before the mission uses this flow.

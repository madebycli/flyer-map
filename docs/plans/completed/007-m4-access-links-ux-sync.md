---
id: plan-007-m4
type: plan
status: completed
last_updated: 2026-08-25
completed_at: 2026-08-24
---

# M4 — Access Links + Authorization + Field UX hardening

> Historical completed plan. Renderer-specific statements below describe the M4 implementation context at the time and are **not current architecture requirements**. Current map architecture is defined by `docs/architecture/MAP.md` and ADR-0010.

## Goal

Protect every shared Campaign request with revocable Worker-enforced credentials and harden shared field UX/synchronization after M3.

## Completed outcomes

- additive `0002_m4_access.sql` migration applied to production D1;
- cryptographically strong access grants and hashed secrets;
- secure HttpOnly sessions and grant revocation;
- Admin / Team Editor / Viewer authorization enforced in the Worker;
- Team Editor server-side snapshot-diff authorization;
- explicit secure bootstrap for pre-M4 Campaigns without race-to-claim;
- Admin access management UI/API;
- Campaign default map focus + personal per-browser camera state;
- arbitrary bearing/compass;
- in-memory remote refresh without full page reload/camera reset;
- active draw/edit protection from remote snapshot replacement;
- German/English application UI;
- tests/typecheck/build green and M4 merged to `main`.

## Permission matrix delivered

- Admin: Campaign settings, Teams, Areas, Tasks/status, Access management.
- Team Editor: read Campaign, write only scoped Team Areas and their Tasks.
- Viewer: read only.

## Security decisions delivered

- Campaign id is a selector only;
- invite token carried in URL fragment and redeemed once;
- D1 stores SHA-256 hashes, not plaintext invite/session secrets;
- protected requests resolve the backing grant so revocation applies to sessions;
- existing Campaign ownership bootstrap requires explicit server-side secret;
- complete snapshot writes retained for M4 with server-side Team Editor diff authorization.

## Production completion

- production D1 `flyer-map-db` received `0002_m4_access.sql` on 2026-08-24;
- Cloudflare runtime secret `M4_BOOTSTRAP_SECRET` configured;
- M4 PR merged to `main`.

## Superseded renderer context

M4 originally retained the earlier full SVG saved-geometry renderer. Whole-city performance work after M4 superseded that renderer boundary. Do not use this historical plan as renderer source of truth.

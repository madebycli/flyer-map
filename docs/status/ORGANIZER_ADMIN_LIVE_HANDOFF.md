---
id: status-organizer-admin-live-handoff
type: status
status: active
last_updated: 2026-09-04
---

# Organizer/Admin Live Handoff — 2026-09-04 17:10 CEST

This file is an additive, lossless live snapshot. Older context/history remains in Git; when values conflict, GitHub remote state and exact-head CI win.

## Exact verified repository state

- Source `mission-rxdb-sync`: `33ab9c0d757da44e0b20b278982a548eafe732aa`.
- Feature `feature/organizer-admin-platform`: `b772906d1cbf046cb982afc46d682c3cbba596c4` (`docs: expand organizer admin handoff graph`).
- Exact-head CI: run `33881431786`, CI #1079 = success.
- PR #76: open, Draft, unmerged, mergeable; base `mission-rxdb-sync`.
- PR #74: open, Draft, unmerged; head `33ab9c0d...`.
- PR #75: open, Draft, unmerged; head `501b8058...`.
- Rollback `mission-release-2026-09-02-manual`: do not touch.

## Production isolation — verified invariant

Committed `wrangler.jsonc` on the feature head is production-safe:

- `main = ./worker/indexFc52.ts`;
- Production D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production rate namespaces `91714001`, `91714002`, `91714003`;
- no committed `ORGANIZATION_LOGIN_LIMITER`;
- no Organizer entrypoint in committed Production config.

`worker/indexOrganizer.ts` remains deploy-specific and must only be bound by isolated Admin staging or a separately approved Production release.

## Admin staging — current blocker

- Branch `organizer-admin-staging`.
- Head `f0e17da54592d37ae6b8c9b3bc23089e2b369e6f` (`ci: harden admin staging release gate`).
- Workflow `.github/workflows/admin-staging-release-v7.yml`.
- Run `33875342446` = failure.
- Worker `flyer-map-admin-staging`.
- D1 `flyer-map-admin-staging-db`.
- Public URL exists: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.
- **The URL is not test-ready. Do not hand it out as finished.**

Sanitized `admin-staging-v7-diagnostics` evidence:

- tests, typecheck, dependency audit, production-safe build, D1 isolation, migrations, TOTP secret, candidate deploy and convergence all succeeded;
- candidate has `ORGANIZATION_PASSWORD_KDF` bound to `OrganizationPasswordKdfDurableObject`;
- candidate has `ORGANIZATION_PASSWORD_KDF_ITERATIONS = 600000`;
- real bootstrap fails with HTTP `503`, `error.code = organization_password_kdf_unavailable`, diagnostic reason `response_500_kdf_failed`;
- browser gates were skipped because bootstrap failed;
- cleanup succeeded and left `bootstrap_count=0`, `organization_count=0`, `account_count=0`, `owned_campaign_count=0`;
- final private worker was restored/deployed as version `1f9734ce-1bb6-47b3-9137-59f2fcc600a1`;
- final `GET /start` = 200;
- unauthenticated `GET /api/organization/me` = 401;
- cross-origin bootstrap = 403;
- rotated smoke bootstrap is rejected after convergence;
- second real defect: `HEAD /api/organization/me` falls through to SPA/assets and returns `200 text/html`, so the API safety/header gate fails and the response lacks the expected `X-Frame-Options: DENY` API header.

## Immediate continuation order

1. Reverify exact current feature/staging heads before every write.
2. Read `worker/organizationPasswordKdf.ts`, `worker/organizationPasswordKdfDurableObject.ts`, `worker/indexOrganizer.ts` and the V7 generated binding contract.
3. Reproduce the internal KDF DO 500 with sanitized diagnostics; do not log password, salt, derived key, TOTP key or bootstrap secret.
4. Fix the DO request/response/runtime root cause. Keep PBKDF2-HMAC-SHA-256 at 600,000; do not silently reduce it just to pass Free-tier runtime.
5. Add a regression test covering the actual serialized DO fetch interface and fail-closed behavior.
6. Fix `/api/*` unsupported-method/HEAD handling so API paths never become SPA HTML 200. Preserve security headers and add regression coverage.
7. Get exact-head feature CI fully green: tests, typecheck, audit, build.
8. Rebuild Admin staging from the exact green feature head without changing committed Production Wrangler.
9. Real API smoke must pass: `/start` -> bootstrap 201 -> password challenge/login -> TOTP -> authenticated `/me` with MFA.
10. Then run real Chromium gate: create Campaign A and B, logout, clear cookies/storage, login + TOTP, confirm A+B persist server-side.
11. Run Invite Enrollment in a clean browser.
12. Run desktop and mobile Chromium smoke.
13. Only then expose the staging URL/setup procedure as a finished test version.

## Remaining master acceptance after the runtime P0

- explicit Legacy Campaign adoption with audit and negative tenant/race tests;
- Admin/Organizer one-time expiring hash-only invites and clean-browser enrollment;
- complete account security: username/password change, organizer reset link, TOTP reset, recovery regeneration, session list/revoke one/all;
- Organizer/Admin management and concurrent last-organizer protection;
- named Role Templates backed by a server-known Capability Registry;
- own-team vs other-team vs explicit cross-team server authorization;
- Campaign Admin console without fake KPIs;
- root Organizer entry without hijacking the Field Map;
- lifecycle and Organizer-only permanent delete with fresh reauth;
- audit/threat-model/rate-limit/CSP/security-header closure;
- no RxDB/Field regression;
- browser acceptance for bootstrap/TOTP/recovery/invite/multi-campaign/logout/cookie-clear/login and desktop/mobile.

## Hard boundaries

No merge, no Ready, no Production deploy, no Production D1 migration, no rollback-branch changes, no mixing PR #74/#75 into PR #76, no test/type/security weakening, no secrets in repo/logs/URLs/browser storage/RxDB/artifacts.

---
id: status-organizer-admin-live-handoff
type: status
status: active
last_updated: 2026-09-05
---

# Organizer/Admin Live Handoff — first full V9 green

This is the current additive live snapshot. Older history remains in Git. GitHub remote state and exact-head CI always outrank embedded SHAs.

## Verified runtime source and CI

- Base: `mission-rxdb-sync` = `33ab9c0d757da44e0b20b278982a548eafe732aa` at the start of this slice; reverify before new writes.
- First fully accepted runtime feature head: `c62385a8c400f68753d1f1f811e2315551153885` (`fix: harden static asset responses`).
- Exact-head PR CI on that runtime head: run `33924375460`, CI #1121 = success; tests, typecheck, dependency audit and production build all green.
- PR #76 remained open, Draft, unmerged and mergeable with base `mission-rxdb-sync`.
- Documentation-only commits may advance the feature head after the runtime proof; reverify the exact current head and its CI before further work.

## Production isolation — unchanged

Committed `wrangler.jsonc` remains production-safe:

- `main = ./worker/indexFc52.ts`;
- Production D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production rate namespaces `91714001`, `91714002`, `91714003`;
- no committed Organizer login limiter;
- no committed Organizer entry point.

No Production deploy and no Production D1 migration were performed. `worker/indexOrganizer.ts` remains isolated deployment-only.

## Isolated Admin staging — first full green

- Branch: `organizer-admin-staging`.
- Workflow: `.github/workflows/admin-staging-release-v9.yml`.
- First completely green V9 run: `33924415528` / #23.
- Run head: `6414aad45489cd2800e7dcf2f9e6bc917e4106b2`.
- Worker: `flyer-map-admin-staging`.
- D1: `flyer-map-admin-staging-db`.
- Public URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.
- Runtime source audited by that run: `c62385a8c400f68753d1f1f811e2315551153885`.

### Evidence from V9 #23

Static gates:

- exact feature derivation passed;
- npm tests passed;
- TypeScript passed;
- dependency audit passed;
- production build passed;
- checked-in staging harness validation passed.

Real Cloudflare/API/browser gates:

- candidate version convergence passed;
- API unsupported-method/fail-closed gates passed;
- bootstrap 201 -> password -> TOTP -> authenticated `/api/organization/me` passed;
- Campaign A and Campaign B were created and persisted server-side;
- logout + storage/cookie clear + fresh Chromium context + login/TOTP showed both campaigns again;
- one-time Admin invite opened in a clean browser, fragment token was removed from the URL, account enrollment completed and invited Admin MFA was accepted;
- mobile Chromium at 390x844 passed with no horizontal overflow;
- cleanup left bootstrap/organization/account/owned-campaign counts at zero and `PRAGMA foreign_key_check` returned no rows.

Final unpinned public safety:

- `GET /start` = 200;
- unauthenticated `GET /api/organization/me` = 401;
- `HEAD /api/organization/me` = 405;
- cross-origin Organization write = 403;
- stale smoke bootstrap credential rejected;
- static HTML and API responses both carry `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Cross-Origin-Opener-Policy: same-origin`.

The final static-header defect from V9 #21 was fixed with `public/_headers`, the supported Cloudflare Workers Static Assets header mechanism. Worker-generated responses remain hardened independently in `worker/indexOrganizer.ts`.

## Test bootstrap credential policy

The final test environment is intentionally clean. A one-time bootstrap credential is required for the first organizer setup. Only its SHA-256 is stored in the isolated staging workflow. Plaintext must never be committed, logged, placed in URLs, browser storage, RxDB or public artifacts. If the test credential is rotated, rerun the entire V9 workflow and only disclose the plaintext after the final run is green.

## Remaining Master acceptance before Production

The isolated staging version is testable; this is not a Production release. Remaining evidence-driven work includes:

- explicit Legacy Campaign adoption + audit + negative tenant/race cases;
- full account security/reset/TOTP/recovery/session lifecycle matrix;
- multiple Organizer/Admin management and concurrent last-organizer protection;
- named Role Templates + server-known Capability Registry;
- own-team/other-team/explicit cross-team authorization;
- Organizer-only permanent Campaign deletion with fresh high-risk reauth;
- audit/threat-model/rate-limit/CSP closure;
- final root Organizer entry and complete Admin console/lifecycle UX;
- preservation of all RxDB/Field regression gates.

## Hard boundaries

No merge, no Ready, no Production deploy, no Production D1 migration, no rollback-branch changes, no mixing PR #74/#75 into PR #76, no test/type/security weakening, no secrets in repository/logs/URLs/browser storage/RxDB/artifacts.

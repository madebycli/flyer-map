---
id: status-organizer-admin-live-handoff
type: status
status: active
last_updated: 2026-09-06
---

# Organizer/Admin Live Handoff

This is the current additive live snapshot. GitHub remote state and exact-head CI always outrank embedded SHAs.

## Product and PR state

- Product branch: `feature/organizer-admin-platform`;
- current Product head: `b22114d4e15774e563d1581cb798ad52f87ccf96`;
- exact-head GitHub Actions CI: Run `34000044120`, conclusion `success`;
- PR #76: open, Draft, unmerged, base `mission-rxdb-sync`;
- PR #74/#75 remain separate.

## Production isolation

Committed `wrangler.jsonc` remains production-safe:

- `main = ./worker/indexFc52.ts`;
- Production D1 `0113e775-1e43-4d96-8b97-51fdeec7355b`;
- Production rate namespaces `91714001`, `91714002`, `91714003`;
- no committed Organizer login limiter;
- no committed Organizer entry point.

No Production deploy and no Production D1 migration were performed. `worker/indexOrganizer.ts` remains isolated deployment-only.

## Persistent manual Admin staging

- Branch: `organizer-admin-staging`;
- workflow: `.github/workflows/admin-staging-persistent.yml`;
- worker: `flyer-map-admin-staging`;
- D1: `flyer-map-admin-staging-db`;
- public URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`;
- green run: `34007250234`.

Persistent evidence:

- state-before and state-after normalized counts are identical;
- no cleanup or SQL deletes are performed;
- `PRAGMA foreign_key_check` is empty;
- `/start=200`, unauthenticated `/api/organization/me=401`, `HEAD=405`, cross-origin write `403`;
- Production safety is green;
- missing TOTP/recovery secrets may be generated only for an empty safe state, and existing secrets are preserved.

The persistent bootstrap digest is stable across code deploys. The plaintext setup key is a one-time private handoff for `/start`; it is never committed, logged or placed into artifacts, URLs, browser storage or RxDB.

## Disposable Plan-031 acceptance

- workflow: `.github/workflows/plan031-live-staging.yml`;
- worker: `flyer-map-admin-acceptance`;
- D1: `flyer-map-admin-acceptance-db`;
- green run: `34007347508`;
- audited Product source: `b22114d4e15774e563d1581cb798ad52f87ccf96`.

The sanitized acceptance artifact confirms:

- API `ok=true`;
- campaign create `201`;
- hidden-list access `200`;
- reveal and rotation `200`;
- revoke and close `200`;
- expiry transition `200`;
- recovery rows: `2` after rotate, then `0` after revoke, close and expiry;
- desktop and mobile browser `ok=true`;
- mobile width `390x844`, no horizontal overflow;
- final cleanup counts are zero;
- migration 0020 exists with encrypted recovery columns and green foreign-key checks;
- final safety has `production_untouched=true`.

## User handoff

Use the persistent URL for manual development. If the persistent D1 is empty, open `/start` and use the one-time setup key to create the first Organizer. After that, continue with the Organizer account, password and MFA; later code deploys do not reset this account or the persistent database.

## Remaining boundaries

No merge, no Ready, no Production deploy, no Production D1 migration, no rollback-branch changes, no mixing PR #74/#75 into PR #76, no test/type/security weakening, no secrets in repository/logs/URLs/browser storage/RxDB/artifacts.

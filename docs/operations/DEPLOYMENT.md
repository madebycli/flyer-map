---
id: operations-deployment
type: operations
status: active
last_updated: 2026-08-25
related: [architecture-stack, architecture-security, architecture-data, architecture-offline-sync, architecture-map]
---

# Deployment

## Target

One Cloudflare Worker deployment containing:
- Vite-built React static assets;
- Worker API routes;
- D1 binding `DB` for shared Campaign persistence.

The repository is the source of truth. Normal releases flow from GitHub `main` to Cloudflare automatically; downloading/uploading builds from a phone is not part of the release process.

## Existing production connection

Cloudflare Workers Builds is connected to `madebycli/flyer-map` and deploys `main` to the existing Workers deployment.

Repository configuration in `wrangler.jsonc` remains the deployment source of truth.

## D1

Production uses one D1 database named `flyer-map-db` with Worker binding name `DB`.

The real Cloudflare-provided database id is stored in the reviewed `d1_databases` entry in `wrangler.jsonc`; no placeholder or invented id is used.

Applied migrations are immutable history:
- `migrations/0001_initial.sql` — initial Campaign/Team/Area/Task schema;
- `migrations/0002_m4_access.sql` — M4 access/session + shared map focus, applied to Production on 2026-08-24.

M5 PR #24 adds:
- `migrations/0003_m5_mutations.sql` — durable mutation idempotency ledger with canonical mutation fingerprint.

Do not rewrite `0001`/`0002` to simulate an upgrade.

Apply unapplied migrations intentionally to the remote database before merging/deploying Worker code that requires them:

```bash
npx wrangler d1 migrations apply flyer-map-db --remote
```

For M5, the expected Cloudflare output must show `0003_m5_mutations.sql` applied successfully (or already applied) before the mutation endpoint is accepted in that environment. Never ask the user to paste a Cloudflare API token or secret into chat.

## M5 migration ordering

PR #24 contains Worker code that queries/inserts `campaign_mutations`. Therefore:

1. repository CI and final code review first;
2. Cloudflare preview build of the exact PR head;
3. apply `0003_m5_mutations.sql` to the D1 database used by the environment where mutation runtime acceptance will occur;
4. then test `POST /api/campaigns/:id/mutations`, offline queue/reconnect/conflict behavior;
5. merge to `main` only after the chosen production database is migration-ready;
6. verify automatic Production deploy and smoke checks.

Do **not** intentionally exercise the new mutation route against a D1 environment that still lacks `campaign_mutations`; that would only produce an expected database failure and is not meaningful acceptance.

## M4 bootstrap and operator recovery secret

M4 intentionally does not allow a pre-M4 Campaign to become owned by whichever browser visits first.

The Worker reads the high-entropy operator credential from Cloudflare secret `M4_BOOTSTRAP_SECRET`. It must never be committed to the repository, written into a Campaign URL, stored in D1 as plaintext invite material, or shared as a normal field access link.

The secret serves two explicit operator operations:

1. **Legacy bootstrap** — only for an existing Campaign that has zero access grants. This creates its first Admin grant/session.
2. **Admin recovery** — for a Campaign that already has grants but where the operator lost the browser session/Admin Access Link. This creates a fresh normal revocable Admin grant/session and returns a new Access token once.

The in-browser recovery form is appropriate when the operator only works online:
- open the Campaign URL;
- when the protected-access recovery panel appears, enter `M4_BOOTSTRAP_SECRET` in the password field;
- the browser sends it only in the same-origin POST request to the Worker;
- the Worker creates a new Admin session for that hostname and returns a one-time fresh Admin Access Link;
- copy/bookmark that Access Link securely;
- the secret itself is not persisted by the application.

Cloudflare branch previews use a different hostname from production, so the production session cookie is not shared with the preview. The recovery flow can intentionally create a preview-host session when real-browser preview testing is required.

If the operator secret may have been exposed, rotate it immediately in Cloudflare. If neither future legacy bootstrap nor operator recovery is desired, remove/rotate it and retain Admin Access Links through normal secure operational handling.

Never add a client-side fallback that grants admin access when authorization is missing.

## Release workflow

Normal flow:

```text
feature branch -> pull request -> CI -> Cloudflare preview
-> real-browser acceptance where required -> merge to main
-> Cloudflare automatic production build/deploy -> production smoke checks
```

Schema-changing releases add the D1 migration gate before runtime acceptance/merge. A green repository build alone does not prove that a missing Worker secret or unapplied D1 migration is ready in production.

## M5 post-migration / post-deploy checks

After the M5 migration and Worker deployment:
1. `/api/health` returns `ok: true`, `persistence: "d1"` and `synchronization: "durable-mutations"`;
2. Campaign id alone cannot read protected Campaign data or submit mutations;
3. Viewer mutation requests return authorization failure and do not create ledger entries;
4. Team Editor may mutate only its scoped Team's Areas/Tasks and cannot change Campaign/Admin configuration;
5. the same mutation id **with the same canonical fingerprint/content** retried with valid access returns the prior applied revision and does not duplicate the effect;
6. reusing the same mutation id with changed content returns `409 mutation_id_reused` and does not acknowledge or apply the changed effect;
7. a safe queued mutation may apply after an unrelated newer Campaign revision when its target precondition still matches;
8. a changed/deleted target produces explicit 409 conflict and is not silently overwritten;
9. save while offline, reload the page, restore access if needed, reconnect, and confirm the queued mutation is still delivered;
10. 401/403 on a queued mutation leaves it locally visible as access-blocked and stops blind retry;
11. transient network/server failure retains the mutation and retries with bounded backoff;
12. manual refresh, `online` and visible-tab return trigger another eligible queue attempt;
13. current localStorage snapshot still provides startup state while IndexedDB is the source of truth for unacknowledged M5 delivery;
14. saved MapLibre Areas/Streets remain visible/selectable and active edit behavior is unchanged from the accepted PR21 baseline.

## Existing access/renderer checks

Keep the existing baseline checks when a release touches those boundaries:
- Admin access/recovery and revocation behavior;
- Team Editor/Viewer scope;
- active draw/edit draft safety during remote refresh;
- personal vs shared camera behavior;
- rotation/compass alignment;
- no application-side saved-geometry projection loop;
- dense Street performance follow-up tracked in #23 until separately accepted.

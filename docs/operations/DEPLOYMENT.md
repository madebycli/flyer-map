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

Cloudflare Workers Builds is connected to `madebycli/flyer-map` and deploys `main` to the existing Workers deployment. Non-production branches produce Worker preview versions/URLs.

Repository configuration in `wrangler.jsonc` remains the deployment source of truth.

## D1 binding and preview isolation

Production uses one D1 database named `flyer-map-db` with Worker binding name `DB`.

Current `wrangler.jsonc` defines only:
- `binding: DB`;
- `database_name: flyer-map-db`;
- the existing `database_id`.

It does **not** define a separate Wrangler environment or `preview_database_id` for M5 browser acceptance.

Cloudflare Worker versions capture their bindings, while state changes in bound D1/KV/R2 resources are not versioned with the Worker. Workers Builds also does not natively create different production/non-production bindings merely because a branch has a preview URL.

Therefore the current repository must treat the M5 Worker preview as **code-isolated but not D1-data-isolated**. Unless an explicit external Cloudflare binding override is later documented, the preview uses the same configured `flyer-map-db` binding.

Operational consequence:
- the additive M5 schema migration must exist in `flyer-map-db` before preview mutation tests;
- use a deliberately disposable/test Campaign for destructive browser acceptance where practical;
- do not assume a preview URL implies a separate database.

A future dedicated staging D1 would require an explicit environment/build configuration. Current M5 does not add that infrastructure.

## D1 migrations

Applied migrations are immutable history:
- `migrations/0001_initial.sql` — initial Campaign/Team/Area/Task schema;
- `migrations/0002_m4_access.sql` — M4 access/session + shared map focus, applied to Production on 2026-08-24;
- `migrations/0003_m5_mutations.sql` — durable mutation idempotency ledger with canonical mutation fingerprint, applied successfully to remote `flyer-map-db` on 2026-08-25.

`0003` only adds the new ledger table/index and does not rewrite existing Campaign/Team/Area/Task/Access rows. This allows the schema to exist before M5 code is merged; the current Production Worker simply ignores the new table until M5 is deployed.

Do not rewrite `0001`/`0002`/`0003` to simulate upgrades.

The migration was applied from branch `m5-resilient-sync-mainline` with:

```bash
npx wrangler d1 migrations apply flyer-map-db --remote
```

Observed non-sensitive Wrangler result on 2026-08-25:
- remote database `flyer-map-db` selected;
- exactly one pending migration listed: `0003_m5_mutations.sql`;
- 4 commands executed;
- migration status `✅`.

Never record Wrangler OAuth codes, Cloudflare API tokens, access links or secret values in repository documentation.

## M5 migration ordering

PR #24 contains Worker code that queries/inserts `campaign_mutations`. Current safe order:

1. repository CI/code review — passed for the accepted runtime-equivalent head;
2. exact Cloudflare runtime-equivalent preview deployment — passed for `5c7dce81...`;
3. apply `0003_m5_mutations.sql` to `flyer-map-db` — passed on 2026-08-25;
4. test `POST /api/campaigns/:id/mutations` and queue/reconnect/conflict behavior through the preview — current gate;
5. merge to `main` only after browser acceptance;
6. verify automatic Production deploy and smoke checks.

## M4 bootstrap and operator recovery secret

M4 intentionally does not allow a pre-M4 Campaign to become owned by whichever browser visits first.

The Worker reads the high-entropy operator credential from Cloudflare secret `M4_BOOTSTRAP_SECRET`. It must never be committed to the repository, written into a Campaign URL, stored in D1 as plaintext invite material, or shared as a normal field access link.

The secret serves two explicit operator operations:
1. legacy bootstrap for an existing Campaign with zero grants;
2. Admin recovery creating a fresh normal revocable Admin grant/session.

Cloudflare branch previews use a different hostname from production, so the production session cookie is not shared with the preview. Recovery may intentionally create a preview-host session when browser preview testing needs Admin access. The secret itself is not persisted by the application.

Never add a client-side fallback that grants admin access when authorization is missing.

## Release workflow

```text
feature branch -> pull request -> CI -> Cloudflare preview
-> additive D1 migration when required
-> real-browser acceptance -> merge to main
-> Cloudflare automatic production build/deploy -> production smoke checks
```

A green repository build alone does not prove that a missing Worker secret or unapplied D1 migration is ready in production.

## M5 post-migration / post-deploy checks

After the M5 migration and Worker deployment:
1. `/api/health` returns `ok: true`, `persistence: "d1"` and `synchronization: "durable-mutations"`;
2. Campaign id alone cannot read protected Campaign data or submit mutations;
3. Viewer mutation requests return authorization failure and do not create ledger entries;
4. Team Editor may mutate only its scoped Team's Areas/Tasks and cannot change Campaign/Admin configuration;
5. the same mutation id with the same canonical fingerprint/content returns the prior applied revision and does not duplicate the effect;
6. same mutation id with changed content returns `409 mutation_id_reused` and does not apply the changed effect;
7. a safe queued mutation may apply after an unrelated newer Campaign revision when its target precondition still matches;
8. a changed/deleted target produces explicit 409 conflict and is not silently overwritten;
9. save while offline, reload, reconnect, and confirm the queued mutation is still delivered;
10. 401/403 on a queued mutation leaves it locally visible as access-blocked and stops blind retry;
11. transient network/server failure retains the mutation and retries with bounded backoff;
12. manual refresh, `online` and visible-tab return trigger another eligible queue attempt;
13. localStorage snapshot remains startup state while IndexedDB is source of truth for unacknowledged M5 delivery;
14. saved MapLibre Areas/Streets remain visible/selectable and active edit behavior is unchanged.

## Existing access/renderer checks

Keep existing baseline checks when a release touches those boundaries:
- Admin access/recovery and revocation behavior;
- Team Editor/Viewer scope;
- active draw/edit draft safety during remote refresh;
- personal vs shared camera behavior;
- rotation/compass alignment;
- no application-side saved-geometry projection loop;
- dense Street performance follow-up tracked in #23 until separately accepted.

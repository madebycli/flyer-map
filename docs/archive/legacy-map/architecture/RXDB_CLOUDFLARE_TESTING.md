# RxDB Cloudflare Remote Test Strategy

This note documents the safe test path for the `mission-rxdb-sync` release candidate. It does not authorize a production deploy, a remote staging deploy, or any remote D1 migration.

## Why the normal PR Workers Build is not the release gate

Cloudflare Workers Builds use `wrangler versions upload` for non-production builds by default. A versions upload cannot apply Durable Object lifecycle changes such as creating a new Durable Object class/namespace. The current branch introduces `CampaignSyncDurableObject`, so the first real remote creation of that namespace must happen through a full `wrangler deploy` in an isolated environment.

Cloudflare also currently does not generate Preview URLs for Workers that implement Durable Objects. A red or missing normal PR preview therefore must not be treated by itself as proof of an application-code failure for this branch.

Official references:

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/wrangler/environments/
- https://developers.cloudflare.com/workers/configuration/versions-and-deployments/deployments/
- https://developers.cloudflare.com/workers/configuration/previews/
- https://developers.cloudflare.com/durable-objects/reference/environments/
- https://developers.cloudflare.com/d1/configuration/environments/
- https://developers.cloudflare.com/d1/reference/migrations/

## Local validation, no remote writes

Run the normal repository gates and then validate Wrangler's deploy bundle without uploading anything:

```sh
npm test
npm run typecheck
npm run audit:dependencies
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

`wrangler deploy --dry-run` compiles the Worker deployment without publishing it. This validates the configured entrypoint and current default binding/migration shape but cannot prove that Cloudflare will successfully create a remote Durable Object namespace.

## Staging configuration preparation

The staging Worker must be `flyer-map-staging`. With the existing top-level Worker name `flyer-map`, Wrangler's named environment `staging` resolves to that isolated Worker name automatically.

The active `env.staging` configuration must be added only after a real dedicated staging D1 resource has been created or identified. It must contain its own non-inheritable bindings, especially `DB` and `CAMPAIGN_SYNC`. The production D1 UUID in the top-level configuration must never appear inside `env.staging`.

Required shape once the real staging resource identifiers exist:

```jsonc
{
  "env": {
    "staging": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "flyer-map-staging-db",
          "database_id": "<REAL_STAGING_D1_DATABASE_ID>",
          "migrations_dir": "migrations"
        }
      ],
      "durable_objects": {
        "bindings": [
          {
            "name": "CAMPAIGN_SYNC",
            "class_name": "CampaignSyncDurableObject"
          }
        ]
      }
    }
  }
}
```

Any other non-inheritable Worker bindings required by the staging smoke must likewise be declared explicitly for `env.staging`; they must not be assumed to inherit from the default environment.

After the real staging D1 ID is inserted, but before any remote deploy, run:

```sh
npx wrangler deploy --dry-run --env staging --outdir .wrangler-staging-dry-run
```

The repository currently has no verified staging D1 database ID. Therefore the active `env.staging` block is intentionally not committed with a guessed ID, a placeholder that could be mistaken for deployable configuration, or the production D1 UUID. The staging dry-run remains an external configuration gate until that real ID is available.

## Staging migration ledger first

Never assume that only `0017_rxdb_sync_changes.sql` is required. Before applying anything to a staging D1 database, inspect its migration ledger using the staging database name rather than an ambiguous binding:

```sh
npx wrangler d1 migrations list flyer-map-staging-db --env staging --remote
```

This lists migrations that are not yet recorded as applied in D1's migration ledger. Do not run `migrations apply` as part of preparation.

The repository migration chain, in required order, is:

1. `0001_initial.sql`
2. `0002_m4_access.sql`
3. `0003_m5_mutations.sql`
4. `0004_m6_task_source_provenance.sql`
5. `0005_m6_house_tasks.sql`
6. `0006_fc1_field_groups.sql`
7. `0007_field_sessions_events.sql`
8. `0008_comments.sql`
9. `0009_automations.sql`
10. `0010_fc5_collection_access_areas_runs.sql`
11. `0011_fc5_collection_pickups.sql`
12. `0012_fc5_collection_pickup_visibility.sql`
13. `0013_fc5_pickup_comments.sql`
14. `0014_auto_area_task_preparation.sql`
15. `0015_mission_campaign_admin_accounts.sql`
16. `0016_mission_campaign_admin_password_resets.sql`
17. `0017_rxdb_sync_changes.sql`

For a brand-new empty staging D1 database, the required migration sequence is the complete chain `0001` through `0017` in that order. For a staging database created as a schema clone, the required sequence is exactly the still-unapplied files returned by the staging migration ledger, preserving the order above. Production must not be queried, mutated, or used as the staging migration target.

## Required remote test path after explicit authorization

Only after staging resource IDs are configured, the staging dry-run is green, and a remote staging deploy is explicitly authorized:

1. Re-check the staging migration ledger.
2. Apply only the ledger-reported missing migrations to `flyer-map-staging-db`, in repository order.
3. Deploy the staging Worker with a full `npx wrangler deploy --env staging`, not `wrangler versions upload`.
4. Run the two-browser/offline/reconnect and Field Group isolation smoke tests against `flyer-map-staging`.
5. Run Android and iPhone browser offline/reconnect smokes.
6. Do not deploy the default/production environment as part of this validation.

## Production boundary

Nothing in this strategy authorizes:

- `npx wrangler deploy` against the default environment,
- `npx wrangler deploy --env staging` without explicit authorization,
- any remote D1 migration during preparation,
- reuse of the production D1 UUID in staging,
- merge of PR #74,
- changing PR #74 out of Draft,
- changes to `mission-release-2026-09-02-manual`.

# RxDB Cloudflare Remote Test Strategy

This note documents the safe test path for the `mission-rxdb-sync` release candidate. It does not authorize a production deploy or a remote D1 migration.

## Why the normal PR Workers Build is not the release gate

Cloudflare Workers Builds use `wrangler versions upload` for non-production builds by default. A versions upload cannot apply Durable Object lifecycle changes such as creating a new Durable Object class/namespace. The current branch introduces `CampaignSyncDurableObject`, so the first real remote creation of that namespace must happen through a full `wrangler deploy` in an isolated environment.

Cloudflare also currently does not generate Preview URLs for Workers that implement Durable Objects. A red or missing normal PR preview therefore must not be treated by itself as proof of an application-code failure for this branch.

Official references:

- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/configuration/versions-and-deployments/deployments/
- https://developers.cloudflare.com/workers/configuration/previews/
- https://developers.cloudflare.com/durable-objects/reference/environments/
- https://developers.cloudflare.com/d1/configuration/environments/

## Local validation, no remote writes

Run the normal repository gates and then validate Wrangler's deploy bundle without uploading anything:

```sh
npm test
npm run typecheck
npm run audit:dependencies
npm run build
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

`wrangler deploy --dry-run` compiles the Worker deployment without publishing it. This validates the configured entrypoint and binding/migration shape but cannot prove that Cloudflare will successfully create the remote Durable Object namespace.

## Required remote test path

A real remote integration test requires an isolated staging environment with all stateful bindings isolated from production:

1. Create or identify a dedicated staging D1 database. Never reuse the production `flyer-map-db` binding for this test.
2. Add an `env.staging` configuration with its own `DB` binding and the `CAMPAIGN_SYNC` Durable Object binding. Cloudflare named environments create a separate Worker and separate Durable Object namespace.
3. Keep the SQLite Durable Object migration in that staging environment.
4. Apply the staging Worker with a full `npx wrangler deploy --env staging`, not `wrangler versions upload`.
5. Apply migration `0017_rxdb_sync_changes.sql` only to the staging D1 database.
6. Run the two-browser/offline/reconnect smoke tests against the staging Worker.
7. Do not deploy the default/production environment as part of this validation.

The repository currently has no verified staging D1 database ID. Therefore an active `env.staging` block must not be committed with guessed or production resource IDs. Provisioning or identifying the staging D1 resource is an external gate before the remote test can be executed safely.

## Production boundary

Nothing in this strategy authorizes:

- `npx wrangler deploy` against the default environment,
- remote application of D1 migration `0017`,
- merge of PR #74,
- changing PR #74 out of Draft,
- changes to `mission-release-2026-09-02-manual`.

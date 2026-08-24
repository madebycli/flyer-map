---
id: operations-deployment
type: operations
status: active
last_updated: 2026-08-24
related: [architecture-stack]
---

# Deployment

## Target

One Cloudflare Worker deployment containing:
- Vite-built React static assets
- Worker API routes
- D1 binding `DB` for shared campaign persistence

The repository is the source of truth. Normal releases flow from GitHub `main` to Cloudflare automatically; downloading/uploading builds from a phone is not part of the release process.

## Existing production connection

Cloudflare Workers Builds is connected to `madebycli/flyer-map` and deploys `main` to the existing Workers deployment.

Repository configuration in `wrangler.jsonc` remains the deployment source of truth.

## M3 D1 setup

M3 uses one D1 database named `flyer-map-db` with Worker binding name `DB`.

The real Cloudflare-provided database id is now stored in the reviewed `d1_databases` entry in `wrangler.jsonc`; no placeholder or invented id is used.

CLI equivalent for creating this database in Western Europe was:

```bash
npx wrangler d1 create flyer-map-db --location=weur
```

Before merging/deploying Worker code that depends on the schema, apply the migration intentionally to the remote database:

```bash
npx wrangler d1 migrations apply flyer-map-db --remote
```

`migrations/0001_initial.sql` is the first production schema for M3. It was an unapplied proposal before M3 and was aligned to the actual shared snapshot model before first application.

## Release workflow

Preferred:

```text
feature branch -> pull request -> CI -> provision/bind D1 -> apply migration -> final green CI -> merge to main -> Cloudflare automatic build/deploy
```

Production config changes are reviewed like code changes.

## Post-deploy checks

After M3 deploy:
1. `/api/health` returns `ok: true` and reports `persistence: "d1"`;
2. existing local campaign data can bootstrap to D1 without being deleted locally;
3. reload restores the server snapshot;
4. opening the same `?campaign=` URL on a second browser loads the same campaign;
5. a change on one browser is detected on the other through revision polling;
6. conflict/rejection behavior is visible rather than silently overwriting state;
7. the CARTO Voyager Retina + independent SVG renderer behaves exactly as before M3.

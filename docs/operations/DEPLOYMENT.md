---
id: operations-deployment
type: operations
status: active
last_updated: 2026-08-24
related: [architecture-stack, architecture-security, architecture-data]
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

## D1

Production uses one D1 database named `flyer-map-db` with Worker binding name `DB`.

The real Cloudflare-provided database id is stored in the reviewed `d1_databases` entry in `wrangler.jsonc`; no placeholder or invented id is used.

`migrations/0001_initial.sql` is immutable M3 production history. M4 adds `migrations/0002_m4_access.sql`; do not rewrite `0001` to simulate an upgrade.

Apply unapplied migrations intentionally to the remote database before merging Worker code that requires them:

```bash
npx wrangler d1 migrations apply flyer-map-db --remote
```

For M4, verify that `0002_m4_access.sql` is reported as applied before production begins serving the protected access/session routes.

## M4 access bootstrap

M4 intentionally does not allow a pre-M4 campaign to become owned by whichever browser visits first.

Existing M3 campaigns require an explicit server-side bootstrap credential. The Worker reads this value from the Cloudflare secret `M4_BOOTSTRAP_SECRET`; it must never be committed to the repository, written into a campaign URL, stored in D1 as plaintext invite material, or shared as a normal field access link.

Before M4 merge/deploy:
1. create a strong random bootstrap secret outside the repository;
2. store it as the Worker secret `M4_BOOTSTRAP_SECRET` in Cloudflare;
3. apply `0002_m4_access.sql` to production D1;
4. after deploy, use the explicit bootstrap API only for campaigns that existed before M4 and still have no access grant;
5. record/share the returned admin access link securely;
6. revoke or rotate the bootstrap secret after the known legacy campaigns are bootstrapped if no further legacy bootstrap is required.

Never add a client-side fallback that grants admin access when authorization is missing.

## Release workflow

Preferred M4 flow:

```text
feature branch -> pull request -> CI -> review migration/security model
-> configure Cloudflare bootstrap secret -> apply D1 migration 0002
-> final green CI -> merge to main -> Cloudflare automatic build/deploy
-> health/auth/sync smoke checks -> legacy campaign bootstrap where required
```

Production config changes are reviewed like code changes. A green repository build alone does not prove that an unapplied D1 migration or missing Worker secret is ready in production.

## Post-deploy checks

After M4 deploy:
1. `/api/health` returns `ok: true` and reports `persistence: "d1"`;
2. campaign id alone cannot read protected campaign snapshot/version data and returns an authorization failure;
3. a valid admin access link redeems into an HttpOnly session and can manage campaign settings, teams and access grants;
4. a team-editor access link can edit only its scoped team's areas/tasks and cannot change campaign/admin configuration;
5. a viewer access link can read but cannot write;
6. revoking a grant invalidates protected access for an already-issued session;
7. opening the same authorized campaign on two browsers receives remote changes through 30-second revision polling, visibility/online refresh or manual refresh without a full-page reload;
8. an active draw/edit/street-draw draft is not silently replaced by a remote snapshot;
9. personal camera center/zoom/bearing survives reload on the same browser and shared campaign focus remains only the fallback for devices without a personal camera;
10. map rotation/compass and the CARTO Voyager Retina + independent SVG renderer remain aligned and usable on a real phone.

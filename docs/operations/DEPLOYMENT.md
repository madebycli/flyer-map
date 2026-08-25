---
id: operations-deployment
type: operations
status: active
last_updated: 2026-08-25
related: [architecture-stack, architecture-security, architecture-data, architecture-map]
---

# Deployment

## Target

One Cloudflare Worker deployment containing:
- Vite-built React static assets;
- Worker API routes;
- D1 binding `DB` for shared campaign persistence.

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

Production `0002_m4_access.sql` was applied successfully on 2026-08-24 before M4 protected routes were merged.

## M4 bootstrap and operator recovery secret

M4 intentionally does not allow a pre-M4 campaign to become owned by whichever browser visits first.

The Worker reads the high-entropy operator credential from the Cloudflare secret `M4_BOOTSTRAP_SECRET`. It must never be committed to the repository, written into a campaign URL, stored in D1 as plaintext invite material, or shared as a normal field access link.

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

Schema-changing releases add the D1 migration gate before merge. The current renderer/access-recovery slice does not require an additional D1 migration beyond `0002_m4_access.sql`.

Production config changes are reviewed like code changes. A green repository build alone does not prove that a missing Worker secret or unapplied D1 migration is ready in production.

## Post-deploy checks

After an access/renderer release:
1. `/api/health` returns `ok: true` and reports `persistence: "d1"`;
2. Campaign id alone cannot read protected Campaign snapshot/version data and returns an authorization failure;
3. a valid Admin Access Link redeems into an HttpOnly session and can manage Campaign settings, Teams and access grants;
4. Admin recovery rejects an incorrect operator secret and, with the configured secret, creates a fresh Admin session/link for an existing Campaign;
5. a Team Editor Access Link can edit only its scoped Team's Areas/Tasks and cannot change Campaign/Admin configuration;
6. a Viewer Access Link can read but cannot write;
7. revoking a grant invalidates protected access for an already-issued session;
8. opening the same authorized Campaign on two browsers receives remote changes through 30-second revision polling, visibility/online refresh or manual refresh without a full-page reload;
9. an active draw/edit/street-draw draft is not silently replaced by a remote snapshot;
10. personal camera center/zoom/bearing survives reload on the same browser and shared Campaign focus remains only the fallback for devices without a personal camera;
11. rotation/compass remain aligned with saved MapLibre geometry and the small active SVG draw/edit overlay on a real phone;
12. saved Areas/Streets stay visible and selectable after Save, edit handles remain edit-only, and ordinary browse pan/zoom/rotate performs no application-side saved-geometry projection loop;
13. representative dense Street datasets are accepted at 500 / 1,000 / 2,500 / 5,000 features or a concrete blocker is recorded before merge.

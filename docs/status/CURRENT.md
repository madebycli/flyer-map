---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M3 — Shared Persistence is complete, merged to `main` through PR #14 and live on the production Cloudflare Worker.

M4 — Access Links + Authorization + Field UX hardening is implemented on branch `m4-access-links-ux-sync` in PR #16. The Cloudflare Worker secret `M4_BOOTSTRAP_SECRET` is configured and production D1 migration `0002_m4_access.sql` was intentionally applied to remote database `flyer-map-db` on 2026-08-24. Final merge/deploy and production smoke checks remain.

## M4 branch state

The M4 branch adds:
- Worker-enforced campaign access for every protected snapshot/version request;
- roles `admin`, `team-editor`, `viewer` with optional team scope;
- strong random invite tokens with only SHA-256 hashes stored server-side;
- opaque HttpOnly/Secure/SameSite session cookies whose authorization resolves the underlying grant on each request;
- immediate access loss after grant revocation, including existing sessions;
- explicit server-secret bootstrap for campaigns that existed before M4; there is no first-visitor-admin fallback;
- admin Access Management API/UI for creating/listing/revoking grants;
- server-side old/new snapshot authorization for team editors so complete-snapshot PUTs cannot mutate campaign settings, teams, foreign areas/tasks or ownership scope;
- Campaign snapshot schema v3 with optional shared `defaultMapView`;
- browser-local personal camera center/zoom/bearing per Campaign;
- arbitrary MapLibre rotation plus compass while application geometry stays in the independent SVG overlay;
- browse Area selection without white halo or stored-corner markers; draw/edit markers remain visible only in the active editing/drawing modes;
- in-memory remote snapshot refresh instead of `window.location.reload()`;
- 30-second revision polling plus online/visibility/manual refresh;
- deferral of remote snapshot application while draw/edit/street-draw is active;
- compact refresh feedback and browser-local German/English application language preference.

## Renderer boundary

M4 itself keeps the proven SVG renderer boundary. A separate post-M4 branch `renderer-webgl-performance` is evaluating a hybrid renderer for whole-city scale: saved Areas/Streets rendered by MapLibre WebGL while active draw/edit previews and edit handles remain SVG-only. This work must not be merged into PR #16.

Current M4 MapLibre responsibilities:
- CARTO Voyager Retina raster basemap;
- camera/navigation/compass controls;
- local one-shot geolocation display.

Current M4 SVG responsibilities:
- saved Areas and Streets;
- active draw/edit previews;
- edit handles only while an Area is actually being edited.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Production history:
- `migrations/0001_initial.sql` — M3 campaign/team/area/task schema; immutable production history.
- `migrations/0002_m4_access.sql` — Campaign default map view plus access-grant/session tables; applied successfully to remote `flyer-map-db` on 2026-08-24.

The migration application reported all 14 commands executed successfully and `0002_m4_access.sql` with status ✅.

## Verification

M3 production verification remains valid for the currently deployed `main` version until the M4 merge finishes.

M4 branch verification:
- authorization/token/session tests cover missing credentials, hashed invite storage, campaign scope, revocation and token redemption;
- permission tests cover Admin, Viewer and Team Editor own-team/foreign-team boundaries;
- snapshot validation tests cover schema v3 and shared map view validation;
- CI #91 passed the complete `npm run check` pipeline: tests, TypeScript and production build;
- Cloudflare Worker secret `M4_BOOTSTRAP_SECRET` is configured;
- remote D1 migration `0002_m4_access.sql` is applied;
- PR #16 is ready for final merge/deploy verification.

## Remaining M4 release steps

1. Confirm the new documentation-only PR head remains green.
2. Merge PR #16 to `main` and allow Cloudflare Workers Builds to deploy it.
3. Smoke-check `/api/health` plus unauthenticated 401 behavior in production.
4. Explicitly bootstrap any known pre-M4 campaign that still needs an initial Admin access link.
5. Smoke-check valid role/revocation/sync behavior.
6. Perform real-phone map/rotation/camera/refresh checks.
7. Mark plan 007 completed after production acceptance.

## Completed plan

- `docs/plans/completed/006-m3-shared-persistence.md`

## Active plan

- `docs/plans/active/007-m4-access-links-ux-sync.md`

## Deferred beyond M4

- durable multi-mutation offline queue (M5)
- WebSockets
- OSM street import/snap-to-road
- House Mode
- GPS routes/history
- PWA/service worker
- traditional email/password account system

## Next

Merge/deploy M4 now that its production schema and bootstrap secret are prepared, complete production/real-device acceptance, then finish the separate whole-city renderer performance slice before placing heavy street density on older phones.
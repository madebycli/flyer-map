---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M3 — Shared Persistence is complete, merged to `main` through PR #14 and live on the production Cloudflare Worker.

M4 — Access Links + Authorization + Field UX hardening is implemented on branch `m4-access-links-ux-sync` in PR #16 and has a green full CI run (#89: tests, TypeScript and production build). It is not yet production-complete because the M4 D1 migration and Cloudflare bootstrap secret are intentional deployment gates that must be handled before merge/deploy.

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
- browse Area selection without white halo or stored-corner markers; draw/edit markers remain visible;
- in-memory remote snapshot refresh instead of `window.location.reload()`;
- 30-second revision polling plus online/visibility/manual refresh;
- deferral of remote snapshot application while draw/edit/street-draw is active;
- compact refresh feedback and browser-local German/English application language preference.

## Renderer boundary

MapLibre continues to render only:
- CARTO Voyager Retina raster basemap;
- camera/navigation/compass controls;
- local one-shot geolocation display.

All Verteil-Flyer areas, streets, draw previews and edit geometry remain in the independent SVG overlay. M4 changes selection presentation and camera behavior but does not reintroduce MapLibre application GeoJSON layers.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Production history:
- `migrations/0001_initial.sql` — M3 campaign/team/area/task schema; immutable production history.

M4 pending deployment migration:
- `migrations/0002_m4_access.sql` — Campaign default map view plus access-grant/session tables.

`0002` must be applied intentionally to production before Worker code that depends on these tables is deployed.

## Verification

M3 production verification remains valid for the current `main` deployment.

M4 branch verification:
- authorization/token/session tests cover missing credentials, hashed invite storage, campaign scope, revocation and token redemption;
- permission tests cover Admin, Viewer and Team Editor own-team/foreign-team boundaries;
- snapshot validation tests cover schema v3 and shared map view validation;
- repository CI #89 passed the complete `npm run check` pipeline: tests, TypeScript and production build;
- PR #16 remains unmerged until the production migration/bootstrap gates are intentionally completed.

## Production gate before M4 merge

1. Configure strong Cloudflare Worker secret `M4_BOOTSTRAP_SECRET` outside the repository.
2. Apply `migrations/0002_m4_access.sql` to remote `flyer-map-db`.
3. Confirm the final PR head remains green after any gate/documentation changes.
4. Merge PR #16 to `main` and allow Cloudflare Workers Builds to deploy it.
5. Smoke-check health plus 401/role/revocation/sync behavior in production.
6. Explicitly bootstrap any known pre-M4 campaign that still needs an initial Admin access link.
7. Perform real-phone map/rotation/camera/refresh checks.

No Cloudflare connector/plugin is available in the current ChatGPT environment, so the production D1/secret operations cannot be truthfully executed from here and must not be fabricated.

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

Finish the explicit M4 production migration/bootstrap gates, merge and deploy PR #16, then complete production/real-device acceptance before moving plan 007 to completed and beginning M5.

---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M4 — Access Links + Authorization + Field UX hardening is merged to `main` through PR #16 at squash commit `e8682778c192b8734f6de35d85821e347cef355b`.

Before merge:
- Cloudflare Worker secret `M4_BOOTSTRAP_SECRET` was configured;
- remote D1 migration `0002_m4_access.sql` was applied successfully to `flyer-map-db`;
- final PR-head CI #100 passed tests, TypeScript and production build.

Production Worker deployment/smoke confirmation is still an explicit acceptance item and must not be inferred merely from the GitHub merge.

A separate post-M4 performance slice is active on branch `renderer-webgl-performance` in draft PR #19.

## M4 capabilities now on main

M4 provides:
- Worker-enforced Campaign access for protected snapshot/version requests;
- roles `admin`, `team-editor`, `viewer` with optional Team scope;
- strong invite tokens with only SHA-256 hashes stored server-side;
- opaque HttpOnly/Secure/SameSite sessions resolved against the underlying grant on each request;
- immediate authorization loss after grant revocation;
- explicit server-secret bootstrap for pre-M4 Campaigns, never first-visitor ownership;
- Admin Access Management API/UI;
- Team Editor old/new snapshot authorization boundaries;
- Campaign snapshot schema v3 with optional shared `defaultMapView`;
- browser-local personal camera center/zoom/bearing per Campaign;
- arbitrary MapLibre rotation and compass;
- browse Area selection without white halo or stored corner/edit markers;
- in-memory remote refresh with 30-second polling plus online/visibility/manual refresh;
- remote snapshot deferral while draw/edit/street-draw is active;
- browser-local German/English application language preference.

## Whole-city renderer performance slice

Real-device use on a Pixel 9 exposed a small visible delay between MapLibre camera movement and saved SVG geometry. This is treated as a scaling warning before a whole city contains hundreds or thousands of Street Tasks.

Draft PR #19 changes the renderer to a hybrid architecture:
- CARTO Voyager Retina remains the raster basemap;
- saved Areas move to MapLibre GeoJSON/WebGL fill + outline layers;
- saved Street Tasks move to one MapLibre GeoJSON source and a small fixed set of status line layers;
- active Area draw, Area edit and Street draw remain SVG;
- Area edit/corner points are visible only during active Area editing/drawing, never for a normally saved/selected Area;
- normal browse pan/zoom/rotate no longer rerenders saved geometry through React merely to follow the camera;
- saved Streets use thin Team-colored road-like lines rather than a broad permanent white/highlighter casing;
- saved Street and Area outline widths scale down while zooming out;
- saved browse hit testing uses MapLibre rendered features.

ADR-0010 records this hybrid renderer decision and supersedes only the old rule that all application geometry had to remain SVG.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Production history:
- `migrations/0001_initial.sql` — M3 campaign/team/area/task schema; immutable history.
- `migrations/0002_m4_access.sql` — Campaign default map view plus access-grant/session tables; applied successfully to remote `flyer-map-db` on 2026-08-24.

The M4 migration application reported 14 commands executed successfully and status ✅.

## Verification

M4:
- final pre-merge CI #100 passed tests, TypeScript and production build;
- PR #16 merged successfully;
- remote D1 migration and bootstrap secret preparation completed;
- production health/auth/role/revocation/real-device smoke checks remain to be explicitly confirmed.

Renderer performance slice:
- first CI #102 passed all 19 domain/security tests and found one MapLibre point-typing issue during TypeScript;
- that issue was fixed by passing a valid point tuple to `queryRenderedFeatures`;
- CI #104 then passed tests, TypeScript and production build on the WebGL renderer implementation;
- final documentation commits require one more PR-head CI run;
- synthetic 500 / 1,000 / 2,500 / 5,000 Street Task and real-device visual/performance checks remain acceptance work.

## Active plans

- `docs/plans/active/007-m4-access-links-ux-sync.md` — keep active until production acceptance is explicitly completed.
- `docs/plans/active/008-renderer-webgl-performance.md` — whole-city renderer performance slice.

## Deferred

- durable multi-mutation offline queue (M5)
- WebSockets
- OSM street import/snap-to-road
- House Mode
- GPS routes/history
- PWA/service worker
- traditional email/password account system

## Next

1. Explicitly confirm the M4 production Worker health/auth smoke after the Cloudflare deployment from `main`.
2. Finish PR #19 CI and device/performance checks.
3. Merge the renderer performance slice only after saved Areas/Streets stay visually locked to the basemap and edit handles remain edit-only.
4. Continue M5 durable mutation work after the renderer baseline is stable.
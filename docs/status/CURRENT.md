---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M4 — Access Links + Authorization + Field UX hardening is merged to `main` and the protected access/session behavior is live. Production D1 migration `0002_m4_access.sql` was applied successfully to remote database `flyer-map-db` on 2026-08-24, and Cloudflare secret `M4_BOOTSTRAP_SECRET` is configured.

The current follow-up slice is **Admin access recovery + whole-city SVG renderer performance** in PR #21 on branch `renderer-access-recovery`.

## Current access issue and recovery

A Campaign id is intentionally only a selector. A browser without a valid session/Access Link receives `access_required` and cannot edit.

This surfaced immediately on the normal/preview website after M4 because:
- an old Admin Access Link/session may no longer be available;
- Cloudflare branch-preview hosts have a different origin, so the production session cookie is not shared.

PR #21 adds an explicit operator recovery flow guarded by the existing high-entropy `M4_BOOTSTRAP_SECRET`:
- missing access shows a browser recovery card;
- the secret is entered in a password field and is not persisted;
- the Worker verifies it server-side;
- a fresh normal revocable Admin grant + secure session is created;
- a new Admin Access Link is returned once for secure saving/bookmarking.

There is still no first-visitor ownership path and Campaign id alone never grants access.

## Renderer state

PR #19 (`renderer-webgl-performance`) attempted to move saved Areas/Streets into MapLibre GeoJSON/WebGL layers. Real-browser acceptance repeatedly failed: saved geometry was invisible/non-interactive even though CI and Cloudflare preview builds were green. PR #19 is closed and must not be merged.

The current renderer remains within the proven architecture boundary:
- MapLibre: CARTO Voyager Retina basemap, camera, rotation/compass and geolocation control;
- SVG: all Verteil-Flyer Areas, Streets, drafts and edit handles.

PR #21 optimizes the stable SVG path instead of replacing it:
- saved Areas are grouped by Team color into a small number of SVG paths;
- saved Streets are grouped by Team color + status;
- saved-path coordinates are updated imperatively from MapLibre camera events instead of forcing a full React geometry reconciliation on every browse frame;
- saved redraws are coalesced to one animation-frame callback;
- offscreen geometry is culled before point projection;
- saved street width scales down when zooming out and no permanent broad white highlighter casing is used;
- Area fill is subtle and outlines are thin;
- stored corner/edit points remain hidden outside active draw/edit modes;
- active edit/draw overlay keeps the established direct redraw behavior so the earlier edit-lag regression is not reintroduced.

## UI follow-up

The manual refresh control is browse-only and is anchored bottom-right immediately above the field toolbar. It no longer expands sideways with `Aktuell`/loading text and uses the same compact surface language as settings/field controls.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Production history:
- `migrations/0001_initial.sql` — M3 campaign/team/area/task schema; immutable production history.
- `migrations/0002_m4_access.sql` — Campaign default map view plus access-grant/session tables; applied successfully to remote `flyer-map-db` on 2026-08-24.

PR #21 requires no new D1 migration.

## Verification

Baseline M4 tests cover authorization/token/session behavior, Viewer/Team Editor/Admin boundaries, schema v3 and Campaign map focus.

PR #21 adds access tests for:
- incorrect/configuration-missing operator recovery secret rejection at the helper boundary;
- fresh Admin grant/session creation even when the Campaign already has existing grants;
- plaintext recovery token not being persisted into D1 statements.

CI #113 passed all 21 tests but initially found a TypeScript name collision between MapLibre `Map` and native JavaScript `Map` collections in the grouped renderer. That compile issue was corrected on the subsequent PR head; final CI/preview acceptance is still required before merge.

## Active plans

- `docs/plans/active/007-m4-access-links-ux-sync.md` — historical M4 production-acceptance cleanup still needs final documentation closure.
- `docs/plans/active/008-renderer-access-recovery.md` — current implementation/acceptance slice.

## Current release gates for PR #21

1. Final CI must pass tests, TypeScript and production build.
2. Cloudflare branch preview must deploy the final head.
3. On the preview host, use the configured operator secret to recover a fresh Admin session/link.
4. Save an Area and confirm it stays visible + selectable immediately.
5. Save a Street and confirm it stays visible + selectable immediately.
6. Confirm stored edit points are absent in browse mode and edit mode is no worse than current `main`.
7. Confirm thin zoom-dependent streets and stable bottom-right refresh placement on desktop + phone.
8. Run synthetic dense-street acceptance (500 / 1,000 / 2,500 / 5,000 features) before declaring whole-city renderer work complete.

## Deferred beyond this slice

- durable multi-mutation offline queue (M5)
- WebSockets
- OSM street import/snap-to-road
- House Mode
- GPS routes/history
- PWA/service worker
- traditional email/password account system

## Next

Get PR #21 green, perform real-browser recovery/render acceptance, merge it, then continue M5 resilient mutation-queue work from the stable renderer baseline.

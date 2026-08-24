---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Milestone

M4 — Access Links + Authorization + Field UX hardening is merged to `main` and the protected access/session behavior is live. Production D1 migration `0002_m4_access.sql` was applied successfully to remote database `flyer-map-db` on 2026-08-24, and Cloudflare runtime secret `M4_BOOTSTRAP_SECRET` is configured.

The current follow-up slice is **Admin access recovery + MetroDreamin-style whole-city renderer** in PR #21 on branch `renderer-access-recovery`.

## Access recovery

A Campaign id is intentionally only a selector. A browser without a valid session/Access Link receives `access_required` and cannot edit.

PR #21 adds an explicit operator recovery flow guarded by the existing high-entropy `M4_BOOTSTRAP_SECRET`:
- missing access shows a browser recovery card;
- the secret is entered in a password field and is not persisted;
- the Worker verifies it server-side;
- a fresh normal revocable Admin grant + secure session is created even if the Campaign already has grants;
- a new Admin Access Link is returned once for secure saving/bookmarking.

There is still no first-visitor ownership path and Campaign id alone never grants access.

Cloudflare Workers Builds separates build-time variables/secrets from Worker runtime bindings. A short-lived PR #21 config experiment declared `M4_BOOTSTRAP_SECRET` through Wrangler `secrets.required`; Cloudflare Vite builds then warned because the runtime secret is intentionally not exposed as `process.env` to the build container. That declaration was removed. The real secret remains a Worker runtime secret.

## Renderer state

PR #19 (`renderer-webgl-performance`) attempted to move saved Areas/Streets into MapLibre GeoJSON/WebGL layers but used an unreliable lifecycle. Real-browser acceptance failed because saved geometry became invisible/non-interactive even though CI was green. PR #19 is closed and must not be merged.

PR #21 then tested grouped SVG and a single Canvas overlay. Both reduced some React/DOM work, but real-device feedback still reported unacceptable lag because saved geometry still required application-side projection/repainting during camera movement. Those intermediate renderers are superseded.

The current PR #21 renderer deliberately follows the architectural pattern used by MetroDreamin for dense GL maps:
- MapLibre owns the persistent saved-geometry rendering pipeline;
- one long-lived GeoJSON source contains all saved Areas;
- one long-lived GeoJSON source contains all saved Street Tasks;
- a small constant set of Fill/Line layers is created once after the MapLibre `load` event;
- actual Campaign data changes update existing sources through `GeoJSONSource.setData()`;
- ordinary browse pan/zoom/rotate performs no Verteil-Flyer `map.project()` loop for saved geometry;
- saved geometry moves in the same MapLibre/WebGL render pipeline as the basemap;
- Street selection uses `queryRenderedFeatures()` with a small screen-space hit box;
- Area selection queries the Area fill layer.

MapLibre persistent layers:
- subtle Team-colored Area fill;
- thin Team-colored Area outline with zoom-dependent width;
- selected-Street halo;
- filtered Street layers for `open`, `completed`, `later`, and `not-deliverable`;
- Street color comes from the Team color feature property;
- Street width is a MapLibre zoom expression and becomes thinner toward city overview;
- no permanent broad white highlighter casing.

The layer/source count is essentially constant whether a Campaign contains 10, 500 or several thousand Streets.

## Active draw/edit renderer

SVG remains only for the small amount of active input geometry:
- Area draw preview and points;
- Area edit preview and edit handles;
- Street draw preview and points.

Camera movement updates these active SVG `points`/marker positions imperatively. React is not intentionally reconciled on every MapLibre camera frame.

Stored corner/edit points remain completely hidden in browse mode.

ADR-0010 (`ADR-0010-maplibre-geojson-saved-geometry-svg-active-editing.md`) records this renderer decision and explicitly treats MetroDreamin as an architectural reference rather than copied application code.

## Browser diagnostics

PR #21 includes an opt-in browser diagnostics panel. Add `diag=1` to the page query string to enable it.

It reports/copies only troubleshooting data needed for renderer acceptance:
- current renderer identifier (`maplibre-geojson` expected);
- recent animation-frame FPS and long-frame counts;
- viewport/device/browser capability hints;
- local Area/Street Task counts;
- MapLibre Canvas count, active SVG node count and total DOM size;
- CARTO basemap resource timing summaries;
- recent browser console errors/warnings observed while diagnostics are enabled.

The diagnostics panel does not persist data, removes the Campaign selector and URL fragment from copied page metadata, and redacts token-like strings.

## UI follow-up

The manual refresh control is browse-only and anchored bottom-right immediately above the field toolbar. It does not expand sideways with `Aktuell`/loading text and uses the compact surface language of the field/settings UI.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Production history:
- `migrations/0001_initial.sql` — M3 campaign/team/area/task schema; immutable production history.
- `migrations/0002_m4_access.sql` — Campaign default map view plus access-grant/session tables; applied successfully to remote `flyer-map-db` on 2026-08-24.

PR #21 requires no new D1 migration.

## Verification

Baseline M4 tests cover authorization/token/session behavior, Viewer/Team Editor/Admin boundaries, schema v3 and Campaign map focus.

PR #21 adds recovery coverage for:
- incorrect/configuration-missing operator recovery secret rejection;
- fresh Admin grant/session creation even when the Campaign already has grants;
- plaintext recovery token not being persisted into D1 statements.

CI #135 passed the MetroDreamin-style MapLibre implementation code: all 21 tests, TypeScript and production build were green. Documentation/diagnostics follow-up commits require one final CI run on the latest PR head before preview acceptance.

## Active plans

- `docs/plans/active/007-m4-access-links-ux-sync.md` — historical M4 production-acceptance cleanup still needs final documentation closure.
- `docs/plans/active/008-renderer-access-recovery.md` — current implementation/acceptance slice.

## Current release gates for PR #21

1. Final CI must pass on the latest PR head.
2. Cloudflare branch preview must deploy that exact latest head.
3. Preview runtime must expose the configured recovery secret so a fresh Admin session/link can be recovered without sharing the secret in chat.
4. Save an Area and confirm it remains visible + selectable immediately.
5. Save a Street and confirm it remains visible + selectable immediately.
6. Confirm stored edit points are absent in browse mode and active editing remains responsive.
7. Pan/zoom/rotate for 5–10 seconds with `diag=1`; renderer must report `maplibre-geojson` and saved geometry must stay visually locked to the basemap.
8. Confirm thin zoom-dependent streets and stable bottom-right refresh placement on desktop + phone.
9. Run dense-street acceptance with 500 / 1,000 / 2,500 / 5,000 realistic Street features before declaring whole-city performance complete.

## Deferred beyond this slice

- durable multi-mutation offline queue (M5)
- WebSockets
- OSM street import/snap-to-road
- House Mode
- GPS routes/history
- PWA/service worker
- traditional email/password account system

## Next

Get the exact latest PR #21 head through CI and Cloudflare preview, perform real-browser recovery + renderer diagnostics, merge only after acceptance, then continue M5 resilient mutation-queue work from the accepted renderer baseline.

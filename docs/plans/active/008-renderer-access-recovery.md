---
id: plan-008-renderer-access-recovery
type: plan
status: active
last_updated: 2026-08-25
related: [architecture-map, architecture-security, quality, operations-deployment, operations-production]
---

# 008 — Access recovery + whole-city renderer

## Goal

Restore Admin access for existing Campaigns without weakening Worker authorization and establish a whole-city renderer that keeps saved geometry locked to the basemap without application-side per-frame projection.

## Current baseline

- M4 access links are live on `main`; Campaign id is a selector, never a credential.
- PR #21 (`renderer-access-recovery`) is the active follow-up branch/PR.
- saved Areas/Streets use persistent MapLibre GeoJSON sources/layers included in the initial map style;
- actual Campaign data changes update those existing sources through `setData()`;
- active draw/edit geometry uses SVG only;
- MapLibre is pinned to **5.7.1** after real-browser testing showed a GeoJSON visibility/interactivity regression with 6.4.1;
- MetroDreamin is an architectural reference for long-lived GL sources/layers, not copied application code.

## Implemented work

### Admin recovery

- same-origin `POST /api/admin/recover` guarded by server-only `M4_BOOTSTRAP_SECRET`;
- can create a fresh normal Admin grant/session when the Campaign already has grants;
- recovery secret is not persisted in browser/D1;
- successful recovery returns a one-time Admin Access Link.

### Saved renderer

- one persistent GeoJSON source for Areas;
- one persistent GeoJSON source for Street Tasks;
- application sources/layers are part of the initial MapLibre style using current Campaign data;
- if Campaign state changes before MapLibre finishes loading, the latest refs are synchronized after `load`;
- later domain changes update existing sources through `setData()`;
- browse pan/zoom/rotate performs no saved-geometry `map.project()` loop.

### Styling/interaction

- subtle Area fill + thin outline;
- thin Team-colored Streets with zoom-dependent width;
- fixed status layers rather than per-Street layers;
- no permanent broad white highlighter casing;
- no stored edit points in browse;
- selection through rendered-feature queries with touch-friendly Street hit box.

### Active editing

- Area draw/edit + Street draw remain SVG;
- only active vertices are projected;
- active SVG positions update imperatively while camera moves.

### Diagnostics

`?diag=1` reports renderer/performance/browser troubleshooting information without exposing Campaign selector/token fragments.

## Repository-controlled acceptance completed

As of 2026-08-25 before the final documentation-cleanup commit:
- PR #21 head `82b252762624b03b38e479efe53ef40aa7639491` was mergeable;
- GitHub Actions CI #168 completed successfully for that exact head;
- the Cloudflare bot reported a successful commit/branch preview deployment for that exact head;
- source review confirms MapLibre 5.7.1 is pinned and saved geometry uses the accepted constant-source/layer architecture;
- stale documentation that still described post-load source creation or grouped-SVG browse rendering has been corrected in the final documentation-cleanup commit.

The final documentation-cleanup head must again receive green CI and an exact Cloudflare preview before merge.

## External acceptance still required

These gates require an actual interactive browser/device against the final Cloudflare preview and cannot be honestly replaced by repository inspection or green TypeScript/unit/build checks:

- save an Area and confirm it remains visible and selectable;
- save a Street and confirm it remains visible and selectable;
- fast pan/zoom/rotate and confirm saved geometry stays visually locked to the basemap;
- enter/leave draw and edit modes and confirm handles exist only while active and remain usable;
- confirm bottom field toolbar positioning on desktop and mobile safe areas;
- verify Admin recovery on the target preview origin with the configured server-only secret;
- verify `?diag=1` reports `maplibre-geojson` and useful FPS/long-frame/source/rendered counts;
- run representative dense acceptance at 500 / 1,000 / 2,500 / 5,000 Street features, or record a concrete reproducible blocker before merge.

No interactive browser/device runner is available in the current repository-only coding session, so these checks are intentionally **not** marked passed.

## Merge/close procedure

Only after all external acceptance gates above pass on the exact final preview head:
1. update this plan with the accepted devices/browser results and dense-data observations;
2. move this file to `docs/plans/completed/008-renderer-access-recovery.md` and set `status: completed`;
3. update `docs/context-map.yaml` so Plan 008 is historical/completed rather than active;
4. update `docs/status/CURRENT.md` to make Plan 009/M5 the active next slice;
5. merge PR #21 to `main`;
6. verify Cloudflare production deployment and post-deploy smoke checks;
7. only then start Plan 009 from fresh current `main`.

## Runtime version rule

Do not upgrade MapLibre from 5.7.1 inside unrelated work. A future upgrade needs dedicated browser acceptance proving saved GeoJSON visibility, hit testing and performance.

## Decision

Use the GL source/layer lifecycle for persistent saved geometry and SVG only for active input. Do not return to full saved SVG/Canvas rendering as the default whole-city architecture.

Do not merge merely because CI is green; real-browser map acceptance remains required.

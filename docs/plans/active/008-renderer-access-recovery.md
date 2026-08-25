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

For PR head `3232e9e180fb3e2706278157e6fabccf0c4efeac` on 2026-08-25:
- GitHub Actions CI #169 completed successfully;
- Cloudflare reported a successful commit/branch preview deployment for the exact head;
- source review confirms MapLibre 5.7.1 is pinned and saved geometry uses the accepted constant-source/layer architecture;
- ADR, deployment, production and status documentation match the initial-style GeoJSON lifecycle used by the code.

Acceptance-note updates after that runtime head change documentation only. Their resulting heads still require normal CI and exact Cloudflare preview deployment before merge, while the runtime browser results below remain applicable because no application/runtime code changed.

## Real-browser acceptance completed

User testing against the Cloudflare preview for runtime head `3232e9e180fb3e2706278157e6fabccf0c4efeac` confirmed:
- saved Area remains visible and selectable after Save;
- saved Street remains visible and selectable after Save;
- pan/zoom/rotate behavior is acceptable and saved geometry remains visually aligned with the map;
- Area edit handles are visible only while active, remain usable during editing and disappear again after leaving the edit flow.

## External acceptance still required

The remaining gates require an actual interactive browser/device against the runtime-equivalent final Cloudflare preview:

- confirm bottom field toolbar positioning on desktop and mobile safe areas;
- verify Admin recovery on the target preview origin with the configured server-only secret;
- verify `?diag=1` reports `maplibre-geojson` and useful FPS/long-frame/source/rendered counts;
- run representative dense acceptance at 500 / 1,000 / 2,500 / 5,000 Street features, or record a concrete reproducible blocker before merge.

No interactive browser/device runner is available in the repository-only coding session, so these remaining checks are intentionally **not** marked passed.

## Merge/close procedure

Only after all remaining external acceptance gates above pass on a runtime-equivalent final preview head:
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

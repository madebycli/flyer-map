---
id: plan-008-renderer-access-recovery
type: plan
status: active
last_updated: 2026-08-25
related: [architecture-map, architecture-security]
---

# 008 — Access recovery + whole-city renderer

## Goal

Restore Admin access for existing Campaigns without weakening Worker authorization and establish a whole-city renderer that keeps saved geometry locked to the basemap without application-side per-frame projection.

## Current baseline

- M4 access links are live on `main`; Campaign id is a selector, never a credential.
- PR #21 is the active follow-up branch/PR.
- saved Areas/Streets use MapLibre GeoJSON sources/layers;
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
- actual data changes update existing sources through `setData()`;
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

## Remaining acceptance

Before merge:
- confirm saved Area remains visible and selectable after Save;
- confirm saved Street remains visible and selectable after Save;
- confirm browse geometry stays visually locked during fast pan/zoom/rotate;
- confirm edit handles appear only in active draw/edit and edit mode remains usable;
- fix/verify bottom field toolbar positioning on desktop/mobile;
- verify Admin recovery on the target origin;
- run final CI on latest head;
- verify Cloudflare preview deploys exact head;
- perform dense acceptance at 500 / 1,000 / 2,500 / 5,000 Street features or document any remaining load-test blocker before merge.

## Runtime version rule

Do not upgrade MapLibre from 5.7.1 inside unrelated work. A future upgrade needs a dedicated browser acceptance proving saved GeoJSON visibility, hit testing and performance.

## Decision

Use the GL source/layer lifecycle for persistent saved geometry and SVG only for active input. Do not return to full saved SVG/Canvas rendering as the default whole-city architecture.

Do not merge merely because CI is green; real-browser map acceptance remains required.

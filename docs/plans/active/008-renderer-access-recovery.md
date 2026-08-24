---
id: plan-008-renderer-access-recovery
type: plan
status: active
last_updated: 2026-08-25
---

# 008 — Access recovery + MetroDreamin-style whole-city renderer

## Goal

Restore Admin access for existing Campaigns without weakening Worker authorization and make whole-city rendering smooth on older phones by moving saved geometry into long-lived MapLibre GeoJSON sources/layers.

## Context

- M4 access links are live on `main`; Campaign id is a selector, never a credential.
- Preview hosts use another origin and do not share the production session cookie.
- PR #19 proved that a naive MapLibre layer migration can fail real-browser visibility/interactivity even with green CI.
- Grouped SVG and Canvas experiments still required JavaScript projection of saved vertices on camera movement and did not meet real-device performance expectations.
- MetroDreamin demonstrates the correct dense-map lifecycle: long-lived GL sources/layers, data updates through source data changes, and rendered-feature hit testing.

## Tasks

1. Admin recovery
- keep same-origin `POST /api/admin/recover` guarded by server-only `M4_BOOTSTRAP_SECRET`;
- allow creation of a fresh Admin grant/session when Campaign already has grants;
- never persist the plaintext recovery secret;
- return a one-time new Admin Access Link.

2. Saved renderer
- one long-lived GeoJSON source for Areas;
- one long-lived GeoJSON source for Street Tasks;
- create sources/layers once after MapLibre `load`;
- use `GeoJSONSource.setData()` only for actual Campaign data changes;
- no saved-geometry `map.project()` work during browse pan/zoom/rotate.

3. Styling
- subtle Area fill + thin outline;
- thin Team-colored Street lines;
- zoom-dependent line widths that shrink toward city overview;
- fixed filtered layers for task statuses;
- compact selected-Street halo only;
- no saved corner/edit points in browse mode.

4. Interaction
- Street selection via `queryRenderedFeatures()` with a small screen-space hit box;
- Area selection via the Area fill layer;
- no application scan/project loop across all Streets during browse clicks.

5. Active editing
- keep Area draw/edit and Street draw in SVG;
- only active vertices are projected;
- map camera movement updates active SVG DOM attributes directly rather than forcing React reconciliation per move event.

6. Diagnostics
- `?diag=1` must report `maplibre-geojson`, FPS, long frames, feature counts, DOM counts, basemap timing and captured browser warnings/errors;
- copied diagnostics must remove Campaign selector/URL fragment and redact token-like strings.

7. UI
- refresh control remains browse-only, compact and anchored directly above the bottom field UI.

8. Documentation and tests
- ADR-0010 records MapLibre GeoJSON saved geometry + active SVG;
- update map architecture/current status;
- keep authorization/recovery tests green;
- TypeScript and production build must pass.

## Acceptance criteria

- recovery can restore a normal Admin session/link without anonymous ownership claiming;
- saved Area remains visible/selectable immediately after Save;
- saved Street remains visible/selectable immediately after Save;
- ordinary browse movement performs no Verteil-Flyer saved-feature projection loop;
- there is no visible lag between basemap and saved geometry;
- edit handles appear only in active edit/draw modes;
- edit mode remains responsive;
- streets remain thin and visually shrink while zooming out;
- `?diag=1` reports `maplibre-geojson`;
- real-device acceptance passes on desktop + Pixel 9 and, where available, older iPhone-class hardware;
- synthetic 500 / 1,000 / 2,500 / 5,000 Street datasets remain usable.

## Decision

Use MetroDreamin as an architectural reference, not as copied application code. Reimplement the general source/layer lifecycle in MapLibre TypeScript while keeping Verteil-Flyer product/domain/security code independent.

Do not merge before real-browser acceptance. CI cannot prove visibility or mobile frame behavior by itself.

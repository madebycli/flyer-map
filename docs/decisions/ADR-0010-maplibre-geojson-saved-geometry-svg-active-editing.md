---
id: adr-0010-maplibre-geojson-saved-geometry-svg-active-editing
type: decision
status: accepted
last_updated: 2026-08-25
---

# ADR-0010 — MapLibre GeoJSON for saved geometry, SVG for active editing

## Context

Verteil-Flyer must remain smooth on older phones while displaying a whole city with hundreds to thousands of saved street tasks.

The original renderer projected every saved Area/Street into a React/SVG overlay during map camera movement. A grouped-SVG optimization reduced DOM work but real-device feedback still reported visible lag. A short-lived Canvas overlay experiment also retained JavaScript `map.project()` work for every visible vertex on camera frames.

A previous PR #19 attempted MapLibre application GeoJSON layers but failed real-browser acceptance because its source/layer lifecycle was not reliable: updates could race style readiness and saved geometry became invisible/non-interactive.

MetroDreamin provides a proven reference architecture for dense line maps: long-lived GeoJSON sources and GL layers own saved rendering; React updates source data only when domain data changes; map movement is rendered entirely by the GL engine; selection uses rendered-feature queries.

## Decision

Saved Verteil-Flyer geometry is rendered by MapLibre GeoJSON sources/layers using the same lifecycle pattern:

- one long-lived GeoJSON source for saved Areas;
- one long-lived GeoJSON source for saved Street Tasks;
- fixed Fill/Line layers created once after the MapLibre `load` event;
- `GeoJSONSource.setData()` only when the in-memory Campaign data changes;
- no application `map.project()` loop for saved geometry during browse pan/zoom/rotate;
- street and area selection through `queryRenderedFeatures()` against the application layers;
- zoom-dependent MapLibre expressions control thin street/area widths;
- status is represented by a small fixed set of filtered Street layers;
- a selected Street uses a dedicated filtered halo layer.

Active geometry input remains an SVG overlay:

- Area draw vertices and polygon preview;
- Area edit preview and edit handles;
- Street draw preview and points.

Camera movement updates only this small active SVG overlay imperatively. Stored corner points are never rendered in browse mode.

## Lifecycle requirements

The MapLibre application sources/layers are not embedded through React and are not repeatedly created/removed.

On map initialization:

1. create MapLibre with the stable CARTO Voyager Retina raster style;
2. wait for the MapLibre `load` event;
3. create application GeoJSON sources if missing;
4. create the fixed application layers if missing;
5. synchronize the latest in-memory Area/Street collections through `setData()`.

If Campaign data changes before map load finishes, refs retain the newest data and the load callback uses that newest data. Subsequent domain changes call `setData()` on the existing sources. No `styledata -> setData()` loop is allowed.

The current product does not switch the underlying map style at runtime. If runtime style replacement is introduced later, source/layer rehydration must become an explicit lifecycle concern.

## Layer model

Areas:
- `vf-areas-fill` — subtle Team-color fill;
- `vf-areas-outline` — thin Team-color outline with zoom-dependent width.

Street Tasks:
- one selected-street halo layer;
- one filtered layer each for `open`, `completed`, `later`, and `not-deliverable`;
- line color comes from the feature Team color property;
- line width is a MapLibre zoom expression so city-overview lines become thinner while zooming out;
- no permanent broad white highlighter casing.

This is a small constant number of sources/layers, independent of whether the Campaign contains 10, 500, or several thousand Street Tasks.

## Interaction

Browse hit testing uses MapLibre rendered-feature queries. Street taps use a small screen-space bounding box around the tap so thin visual lines remain touchable. Area taps query the Area fill layer.

Editing continues to use the established SVG edit-handle hit test because only a small number of active vertices are involved.

## Performance consequence

During ordinary browse pan/zoom/rotate, Verteil-Flyer performs no per-feature saved-geometry projection and no React reconciliation for Areas/Streets. Rendering is performed in the same MapLibre/WebGL pipeline that moves the basemap.

Domain updates still require GeoJSON serialization and `setData()`, but those occur on explicit data/sync changes rather than every camera frame.

## Reference and licensing

MetroDreamin is used as an architectural reference, not copied wholesale. Its repository is AGPL-3.0. Verteil-Flyer reimplements the general GL source/layer/data-flow pattern in its own TypeScript/MapLibre code and does not copy MetroDreamin application code or product-specific implementation verbatim.

## Rejected alternatives

- per-feature React/SVG browse renderer — reliable but does not meet real-device whole-city performance goals;
- grouped SVG browse renderer — less DOM work, but still requires JavaScript projection of visible vertices on camera frames;
- Canvas browse overlay — fewer DOM nodes, but still requires JavaScript projection/repainting on camera frames;
- returning to the PR #19 lifecycle — rejected because real browsers showed invisible/non-interactive saved geometry.

## Acceptance

Before merge, real-device preview acceptance must confirm:

- saved Area remains visible and selectable after Save;
- saved Street remains visible and selectable after Save;
- browse pan/zoom/rotate has no visible overlay lag;
- edit points only appear in active edit/draw modes;
- edit mode remains responsive;
- `?diag=1` reports `maplibre-geojson` and useful FPS/long-frame data;
- dense synthetic datasets remain usable at 500 / 1,000 / 2,500 / 5,000 Street Tasks.

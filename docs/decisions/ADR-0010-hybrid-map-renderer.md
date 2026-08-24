---
id: adr-0010-hybrid-map-renderer
type: decision
status: accepted
last_updated: 2026-08-24
---

# ADR-0010 — Hybrid MapLibre/WebGL + SVG renderer

## Context

The earlier mobile-stability architecture rendered all Verteil-Flyer application geometry in an independent SVG overlay above a MapLibre raster basemap. That boundary was useful while stabilizing map loading and editing behavior, but real-device use now shows a small visible lag between camera movement and the saved SVG geometry even with only a few Areas and Street Tasks.

A whole-city campaign can contain hundreds or thousands of Street Tasks. Reprojecting every stored coordinate through `map.project()` and triggering React/SVG updates on every pan/zoom/rotate frame scales poorly compared with letting MapLibre keep persistent geometry in its WebGL render loop.

## Decision

Use a hybrid renderer:

- CARTO Voyager Retina remains the basemap.
- Saved Areas are stored as normal domain GeoJSON but rendered through one MapLibre GeoJSON source plus a small fixed set of fill/outline layers.
- Saved Street Tasks are rendered through one MapLibre GeoJSON source plus a small fixed set of line layers for status and selection.
- Saved geometry uses MapLibre rendered-feature hit testing in browse mode.
- Active Area draw, Area edit preview, edit handles and Street draw preview remain in the independent SVG overlay.
- Stored Area edit/corner points are never rendered outside active edit mode.
- Normal browse pan/zoom/rotate must not trigger React renders solely to reposition saved geometry.
- Persistent Street lines use zoom-dependent widths so they become visually thinner when zooming out and read like colored roads rather than broad highlighter strokes.
- The saved Area fill is intentionally low-opacity; ownership is carried primarily by a crisp team-colored boundary and the team-colored Street Tasks.

## Consequences

Benefits:
- saved geometry moves in the same GPU/WebGL render loop as the map camera;
- much better headroom for whole-city Street density;
- fewer DOM/SVG nodes and no per-frame projection of every saved vertex;
- MapLibre can perform browse hit testing on already-rendered features;
- active edit UI stays simple and touch-friendly in SVG.

Trade-offs:
- application geometry is no longer entirely independent of MapLibre;
- MapLibre source/layer lifecycle becomes part of MapView correctness;
- styling and interaction tests must cover both WebGL saved geometry and SVG edit geometry.

## Supersedes

This ADR supersedes only the earlier rule that *all* application geometry must remain SVG. It does not change the accepted basemap/provider decisions, website-only architecture, M4 authorization model, persistence schema, or sync semantics.
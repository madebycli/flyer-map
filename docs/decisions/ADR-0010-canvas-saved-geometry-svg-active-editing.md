---
id: adr-0010-canvas-saved-geometry-svg-active-editing
type: decision
status: accepted
last_updated: 2026-08-24
related: [architecture-map, architecture-quality]
---

# ADR-0010: Canvas for saved geometry, SVG for active editing

## Status

Accepted.

## Context

The original stable mobile map architecture rendered all Verteil-Flyer geometry in an SVG overlay above a MapLibre + CARTO Voyager Retina raster basemap.

That architecture was reliable and kept application geometry independent from the basemap, but real-device testing showed visible lag during camera movement even with only a small number of Areas and Street Tasks. A later attempt in PR #19 to move saved application geometry wholesale into MapLibre GeoJSON/WebGL layers failed real-browser visibility and hit-testing acceptance despite green CI and was abandoned.

A grouped-SVG optimization reduced DOM node count but still did not meet the real-device performance target.

The target workload is a full small/medium city with hundreds to potentially thousands of saved street segments, including older phones.

## Decision

Keep MapLibre responsible only for the raster basemap, camera, compass/rotation and geolocation control.

Render application geometry as two independent overlays:

1. **Saved geometry: one HTML Canvas overlay**
   - saved Areas and saved Street Tasks are drawn on a single transparent Canvas;
   - geometry remains Campaign data and is projected through the current MapLibre camera;
   - feature bounds are precomputed and offscreen features are culled before point projection;
   - MapLibre camera events are coalesced to at most one Canvas redraw per animation frame;
   - Canvas device-pixel-ratio is capped at 2 for predictable mobile backing-buffer cost;
   - Area/Street hit testing remains application geometry logic rather than Canvas pixel picking.

2. **Active geometry: SVG overlay**
   - area draw/edit previews and vertex handles remain SVG;
   - street draw previews and handles remain SVG;
   - camera movement updates the small active SVG directly without forcing a React rerender per map movement frame.

Saved street strokes remain visually thin and zoom-dependent. They must become thinner in city overview rather than preserving a constant thick highlighter width.

## Consequences

Positive:
- one saved-geometry DOM node instead of hundreds/thousands of SVG feature nodes;
- no React reconciliation of saved geometry during pan/zoom/rotate;
- no React rerender on every camera frame in active edit mode;
- preserves the real-browser reliability of an application-owned overlay rather than depending on MapLibre application layers;
- keeps existing geometric selection and authorization boundaries unchanged.

Tradeoffs:
- visible saved vertices still require projection work on redraw;
- Canvas is immediate-mode and must be redrawn after camera/data changes;
- Canvas itself does not provide DOM feature nodes, so accessibility/interaction stays in the surrounding UI and application hit-test logic;
- whole-city performance still requires real-device diagnostics and cannot be considered proven by CI alone.

## Rejected alternatives

### Per-feature or grouped SVG for all saved geometry

Rejected for the hot browse path after real-device tests still showed unacceptable camera-movement lag.

### MapLibre GeoJSON/WebGL application layers

Rejected for the current product baseline because PR #19 repeatedly produced invisible/non-interactive saved geometry in real browser acceptance while CI remained green.

### Canvas for active edit handles

Rejected for now. SVG remains easier and more reliable for the small number of interactive draft/edit vertices.

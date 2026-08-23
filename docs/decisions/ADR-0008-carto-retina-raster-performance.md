---
id: ADR-0008
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0008: Prefer CARTO Retina raster tiles for MVP map performance

## Context

Real-device testing on the production website showed that the CARTO Positron vector style could take roughly 10–20 seconds before the first useful map appeared on a mobile connection. Moving the map also exposed blank/white regions while additional resources and tiles were fetched.

The product is a field tool. Fast, predictable map interaction matters more for the MVP than retaining a fully vector-rendered basemap.

Earlier tests also established that ordinary 256 px OpenStreetMap raster tiles looked visibly soft on high-DPI phones.

## Decision

Keep MapLibre GL JS, but use CARTO Positron Retina raster tiles as the background basemap:

`https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png`

Use all four documented CARTO CDN hostnames (`a`, `b`, `c`, `d`) and keep the source isolated in `MapView`.

Load MapLibre through the normal module graph rather than a runtime dynamic import because the map is the primary screen, not an optional secondary feature.

Configure MapLibre to retain pending lower-zoom tile requests during zooming for smoother visual continuity on slower mobile connections.

## Consequences

Positive:
- fewer external resource types than a full vector style;
- no separate style/glyph/font request chain;
- 2x tiles are sharper on high-DPI displays than standard 256 px raster tiles;
- simpler failure surface;
- more predictable mobile behavior;
- application-controlled polygons, lines and task overlays remain crisp vectors above the raster basemap.

Tradeoffs:
- basemap labels and roads are pre-rendered images rather than individually styleable vectors;
- retina raster tiles can transfer more bytes per tile than low-resolution raster tiles;
- public CARTO CDN availability remains an external dependency.

## Supersedes

ADR-0007's CARTO-vector-as-primary strategy for the MVP. Earlier ADRs remain decision history.

## Revisit when

Revisit if field testing shows the Retina raster source is still too slow, if usage grows enough to require a controlled tile service, or if a reliable self-hosted/regional vector basemap becomes operationally worthwhile.

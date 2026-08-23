---
id: ADR-0004
type: decision
status: accepted
date: 2026-08-24
supersedes: null
related: [ADR-0003]
---

# ADR-0004: Temporarily use OpenStreetMap standard raster tiles as the MVP basemap

## Context

The first deployed production test rendered OpenFreeMap's low-zoom world view but failed to provide usable detail when zooming in.

OpenFreeMap has had a production-origin issue where the style document loads successfully while requests for the `/planet` vector source receive a 403/CORS failure. This failure mode matches the observed behavior closely.

The project currently has very low expected traffic and needs a working, key-free map for field testing more than it needs a custom vector basemap style.

## Decision

Keep MapLibre GL JS as the renderer, but temporarily use the standard OpenStreetMap raster tile endpoint as the MVP basemap.

The basemap remains isolated from application-controlled distribution layers so a different provider can replace it later without changing campaign/task data.

## Constraints

While using the standard OpenStreetMap tile service:

- only normal interactive viewport requests are allowed;
- no bulk download or prefetch is allowed;
- no offline map-area download is allowed;
- visible OpenStreetMap attribution must remain present;
- browser Referer behavior must not be intentionally suppressed;
- the provider must be revisited if usage becomes materially larger.

## Consequences

Positive:

- restores useful street-level zoom without an API key;
- retains MapLibre and the planned application-layer architecture;
- minimal code change;
- suitable for the current tiny test audience.

Negative:

- raster tiles are less flexible than a vector basemap;
- the OSM standard tile service is best-effort and has no SLA;
- offline basemap downloads are explicitly out of scope;
- a production-scale deployment should use a more appropriate hosted or self-managed provider.

## Revisit when

- OpenFreeMap production-origin detail loading is verified stable again;
- an alternative key-free/low-cost vector provider is selected;
- offline basemap support becomes a requirement;
- usage grows beyond small field-test volumes.

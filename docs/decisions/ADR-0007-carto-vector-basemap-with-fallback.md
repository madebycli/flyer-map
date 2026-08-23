---
id: ADR-0007
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0007: Use CARTO vector basemap with automatic OSM fallback

## Context

The project needs a crisp high-DPI basemap on modern phones, but field tests exposed two availability problems with previous providers:

- OpenFreeMap rendered low zoom but failed at street-level detail from production.
- VersaTiles rendered a fully white map in the real production phone test.

The standard OpenStreetMap raster fallback is reliable enough for the small MVP traffic but visibly soft on high-DPI displays.

## Decision

Keep MapLibre GL JS and use CARTO Positron as the primary vector style:

`https://basemaps.cartocdn.com/gl/positron-gl-style/style.json`

Retain the standard OpenStreetMap raster style inside `MapView` as an automatic runtime fallback.

If the primary vector map emits an early loading error or does not complete its first render within a short timeout, switch automatically to the raster style rather than leaving the user with a blank map.

## Consequences

- normal operation uses sharp vector rendering
- no Google Maps dependency or API-key setup is introduced
- a third-party basemap outage is less likely to make the field UI unusable
- the raster fallback remains lower visual quality and must follow OSM tile-service rules
- basemap configuration stays isolated and replaceable

## Supersedes

ADR-0005 as the current normal production basemap decision.

ADR-0004 remains valid as the emergency raster-fallback rationale.

## Revisit when

Traffic grows materially, stronger availability guarantees are needed, a self-controlled basemap becomes practical, or provider terms/availability change.

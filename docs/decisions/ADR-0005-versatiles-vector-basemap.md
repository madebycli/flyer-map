---
id: ADR-0005
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0005: Use VersaTiles public vector basemap for the field UI

## Context

The temporary OpenStreetMap raster fallback restored street-level map availability after an OpenFreeMap production-origin issue, but 256 px raster tiles look visibly soft on modern high-DPI phones.

The field UI needs crisp labels, roads and building outlines on current iPhone/Android displays without requiring a paid map service or additional API-key administration for the MVP.

## Decision

Keep MapLibre GL JS as the renderer and use the public VersaTiles vector basemap style:

`https://tiles.versatiles.org/assets/styles/colorful/style.json`

VersaTiles operates a public vector-tile server and does not require an API key for this endpoint.

## Consequences

- street labels and geometry render sharply at device resolution
- no raster upscaling artifacts on high-DPI phones
- no additional account or API key is required
- public basemap availability remains an external operational dependency
- the public VersaTiles frontend/style endpoint can evolve, so the provider remains isolated in `MapView`

## Supersedes

ADR-0004's OSM-raster fallback as the normal production basemap. ADR-0004 remains part of the decision history and can still serve as an emergency fallback strategy.

## Revisit when

A stable self-controlled basemap is needed, the public service no longer meets availability needs, or the application requires offline basemap packages.

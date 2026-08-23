---
id: ADR-0003
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0003: Use MapLibre with an OpenStreetMap-based basemap

## Context

The product requires an interactive mobile map, custom distribution layers and device location while avoiding unnecessary API-key/billing administration.

## Decision

Use MapLibre GL JS. Start with OpenFreeMap's OpenStreetMap-derived vector style. Keep the basemap provider replaceable.

## Consequences

- no Google Maps dependency for the MVP
- custom polygons/lines/markers remain under application control
- MapLibre is a significant but justified client dependency
- public basemap availability is an external operational dependency

## Revisit when

A required map feature or availability requirement is not adequately served by this stack.

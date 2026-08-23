---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture, product-ux, architecture-security]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary]
---

# Map Architecture

## Renderer

MapLibre GL JS renders the interactive map inside the mobile website.

The module is dynamically imported by `MapView` so the rest of the website shell can remain a separate small chunk.

## Basemap

Current MVP provider:

`https://tiles.versatiles.org/assets/styles/colorful/style.json`

This is a vector basemap derived from OpenStreetMap data and rendered by MapLibre at device resolution. It replaces the temporary standard OSM raster fallback, whose 256 px image tiles looked visibly soft on high-DPI phones.

The basemap provider is an operational dependency, not a domain dependency. Keep it isolated and replaceable.

History:
- OpenFreeMap was the initial vector provider but the first production-origin test lost street-level detail.
- Standard OSM raster tiles were used as an emergency fallback and restored detail.
- VersaTiles is now used to regain crisp vector rendering without requiring an API key.

## Application layers

Team areas, distribution tasks and task state must be rendered as separate application-controlled layers above the basemap.

Do not encode distribution state by editing the basemap itself.

## Geolocation

MapLibre's geolocation control may display the device's current location after browser permission is granted.

Rules:
- permission is user initiated
- location is not written to the Worker/D1 in MVP
- no route history is created
- map use remains possible when permission is denied

## Offline/connectivity behavior

The project is website-only and does not use a PWA service worker. Future resilience work may locally queue important distribution mutations in browser storage, but must not turn the product into an installable PWA or bulk-cache basemap regions.

## Future OSM import

A bounded import can later create task snapshots from OpenStreetMap/Overpass data. Imported task geometry must be stored as campaign data rather than relying permanently on mutable upstream OSM object state.

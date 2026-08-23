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

MapLibre GL JS renders the interactive vector map.

The module is dynamically imported by `MapView` so the rest of the app shell can remain a separate small chunk.

## Basemap

Initial provider:

`https://tiles.openfreemap.org/styles/liberty`

OpenFreeMap is an operational dependency, not a domain dependency. Keep the style/provider configuration isolated.

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

## Future OSM import

A bounded import can later create task snapshots from OpenStreetMap/Overpass data. Imported task geometry must be stored as campaign data rather than relying permanently on mutable upstream OSM object state.

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

MapLibre GL JS renders the interactive map.

The module is dynamically imported by `MapView` so the rest of the app shell can remain a separate small chunk.

## Basemap

Current MVP provider:

`https://tile.openstreetmap.org/{z}/{x}/{y}.png`

The standard OpenStreetMap raster basemap is used temporarily because the first production test showed that OpenFreeMap's low-zoom world layer loaded while detail vector tiles failed from the deployed production origin. A matching OpenFreeMap production-domain `/planet` 403/CORS failure has been reported upstream.

This is an operational fallback, not a domain dependency. Keep the basemap provider isolated and replaceable.

Rules while using the OpenStreetMap standard tile service:
- only request tiles for the viewport a user is actively viewing;
- do not prefetch, bulk-download or offer offline map downloads;
- keep visible OpenStreetMap attribution;
- do not add a restrictive referrer policy that strips the browser Referer;
- revisit the provider before usage grows materially.

Application offline support may cache the app shell and pending distribution changes, but must not prefetch/cache OSM basemap areas for offline use.

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

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

The map is a primary field interface, so MapLibre is loaded as a normal application dependency instead of through a second-stage dynamic import. This avoids an avoidable startup waterfall before the first map request can begin.

## Basemap

Primary MVP provider:

CARTO Voyager Retina raster tiles:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The source uses four CARTO CDN hostnames and 2x-resolution tiles. Voyager is intentionally preferred over the nearly monochrome Positron style because the field map benefits from visible road hierarchy, green spaces and water while retaining the same Retina-raster/CDN performance strategy.

Why this tradeoff is acceptable:
- 2x tiles are materially sharper than the previous 256 px OSM emergency tiles on high-DPI phones;
- raster rendering avoids vector style, glyph and font request waterfalls;
- CARTO serves the basemap through a CDN;
- four tile hostnames allow viewport tile requests to be distributed;
- Voyager restores a more familiar colorful street-map appearance without returning to the slower vector-style loading path;
- the field UI values predictable loading over advanced vector styling.

The basemap provider remains an operational dependency, not a domain dependency. Keep it isolated and replaceable.

### Mobile loading behavior

MapLibre keeps pending lower-zoom tile requests while the user zooms so previously requested context can progressively appear instead of being abruptly canceled.

The map uses a neutral warm background beneath the tile layer and a small initial `Karte lädt…` status so a slow connection does not present a featureless white screen.

Do not prefetch whole areas or build an offline basemap cache. Only normal interactive viewport requests are allowed in the current architecture.

History:
- OpenFreeMap was the initial vector provider but the first production-origin test lost street-level detail.
- Standard OSM raster tiles restored availability but looked soft on high-DPI displays.
- VersaTiles restored vector rendering in theory but produced a white map on the real production phone test.
- CARTO Positron vector style rendered but real-device testing showed unacceptably slow first render and tile/resource loading while moving.
- CARTO Positron Retina raster improved the loading path but its nearly colorless visual design was rejected in real-device review.
- CARTO Voyager Retina raster is the current performance-oriented and more colorful MVP choice.

## Application layers

Team areas, distribution tasks and task state must be rendered as separate application-controlled vector/GeoJSON layers above the basemap.

The raster choice applies only to the background map. Distribution geometry and status remain crisp application-controlled overlays.

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

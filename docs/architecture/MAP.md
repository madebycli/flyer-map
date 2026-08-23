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

The map is the primary field interface. MapLibre is loaded as a normal application dependency instead of through a second-stage dynamic import so the first map request can begin immediately.

## Basemap

Primary MVP provider:

CARTO Voyager Retina raster tiles:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The source uses four CARTO CDN hostnames and 2x-resolution tiles. Voyager remains preferred because it provides readable road hierarchy, green spaces and water while retaining the simpler Retina-raster loading path.

The basemap provider is an operational dependency, not a domain dependency. Keep it isolated and replaceable.

### Mobile loading behavior

MapLibre keeps pending lower-zoom tile requests while the user zooms so previously requested context can progressively appear instead of being abruptly canceled.

Do not gate the field UI on MapLibre `idle`. `idle` can be delayed by ongoing raster requests or interaction and previously left a centered `Karte lädt…` indicator visible on the production phone. Application overlays are initialized when the map style has loaded; no persistent centered loading badge is required after that point.

Do not prefetch whole areas or build an offline basemap cache. Only normal interactive viewport requests are allowed in the current architecture.

History:
- OpenFreeMap was the initial vector provider but the first production-origin test lost street-level detail.
- Standard OSM raster tiles restored availability but looked soft on high-DPI displays.
- VersaTiles restored vector rendering in theory but produced a white map on the real production phone test.
- CARTO Positron vector style rendered but real-device testing showed unacceptably slow first render and resource loading while moving.
- CARTO Positron Retina raster improved the loading path but its nearly colorless visual design was rejected in real-device review.
- CARTO Voyager Retina raster is the current performance-oriented and more colorful MVP choice.

## Application layers

Team areas, street tasks and task state are separate application-controlled GeoJSON layers above the basemap. The raster choice applies only to the background map.

### Reliability boundary

A single optional application layer must never be able to prevent every distribution overlay from rendering.

Current rules:
- add GeoJSON sources independently;
- add application layers independently and report a failed layer without aborting the rest of setup;
- keep saved areas, selected areas, street statuses and selected streets in simple dedicated sources where useful;
- update every available source even if another optional layer failed;
- do not make application-state readiness depend on raster-tile `idle`.

This boundary was introduced after the production phone showed the basemap while all application geometry, draft points and status overlays remained invisible.

### Area behavior

- every stored area is a GeoJSON Polygon assigned to exactly one team;
- fill and outline colors come from the assigned team;
- stored areas are shown together with transparent fills and strong outlines;
- a selected area is copied into a dedicated selected-area source and receives a high-contrast white halo plus stronger team-color outline;
- drawing uses separate draft shape/point sources;
- editing uses separate preview geometry and large vertex handles;
- on phones, editing is tap-handle-then-tap-destination rather than relying on tiny draggable vertex buttons;
- the client validates polygon geometry before Save is enabled.

### Street Mode behavior

- every street task is a GeoJSON LineString assigned to one area;
- the line inherits the area's team color for ownership context;
- a white casing keeps street tasks readable above both the raster basemap and colored area fills;
- task statuses are fed into dedicated status sources/layers so the rendering path stays simple;
- status uses line pattern/weight/opacity in addition to color:
  - `open`: strong solid team-color line;
  - `completed`: thinner and visibly faded solid line;
  - `later`: dashed line;
  - `not-deliverable`: dotted line;
- a selected street is rendered through a dedicated selected-task source with a strong outer halo;
- manual street tracing uses a separate draft LineString and large point markers;
- street-task hit testing uses a larger screen-space box around the tap for phone usability;
- street status changes happen through explicit UI controls, never through map panning or accidental line taps.

Do not encode distribution state by editing the basemap itself.

## Interaction modes

The map has explicit browser-side modes:
- `browse`: pan/zoom and select stored areas or street tasks;
- `draw`: map taps add area polygon vertices; Save/Cancel/Undo are explicit;
- `edit`: stored area geometry remains unchanged until the edited preview is explicitly saved;
- `street-draw`: map taps trace a street LineString; Save/Cancel/Undo are explicit.

Double-click zoom is disabled in geometry-input modes to reduce accidental points while normal drag/pinch map navigation remains available.

## Geolocation

MapLibre's geolocation control may display the device's current location after browser permission is granted.

Field behavior is one-shot centering, not continuous camera tracking. Pressing the location control may center the map on the current device location. After that, both panning and zooming are fully manual; the camera must not snap back until the user presses the location control again.

Rules:
- permission is user initiated;
- location is not written to browser campaign data or Worker/D1 in MVP;
- no route history is created;
- map use remains possible when permission is denied.

## Offline/connectivity behavior

The project is website-only and does not use a PWA service worker. Future resilience work may locally queue important distribution mutations in browser storage, but must not turn the product into an installable PWA or bulk-cache basemap regions.

## Future OSM import

A bounded import can later create task snapshots from OpenStreetMap/Overpass data. Imported task geometry must be stored as campaign data rather than relying permanently on mutable upstream OSM object state.

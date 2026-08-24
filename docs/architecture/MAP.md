---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture, product-ux, architecture-security]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary]
---

# Map Architecture

## Renderer boundary

The production-phone stability phase established the current map architecture and it is a release gate.

MapLibre GL JS renders only:
- the CARTO Voyager Retina raster basemap;
- navigation controls;
- local one-shot browser geolocation display.

All Verteil-Flyer application geometry is rendered by the independent SVG overlay above the MapLibre canvas:
- saved team areas;
- saved street tasks;
- area-draw geometry and points;
- street-draw geometry and points;
- area-edit preview geometry and edit points;
- selected-area halo/outline and one marker at every stored polygon corner;
- selected-street highlight.

Do **not** reintroduce MapLibre application GeoJSON sources/layers for this geometry. M3 persistence changes the snapshot source, not the renderer.

## Basemap

Primary MVP provider:

CARTO Voyager Retina raster tiles:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The source uses four CARTO CDN hostnames and 2x-resolution tiles. Voyager remains preferred because it provides readable road hierarchy, green spaces and water while retaining the simpler Retina-raster loading path.

The basemap provider is an operational dependency, not a domain dependency. Keep it isolated and replaceable.

### Mobile loading behavior

MapLibre keeps pending lower-zoom tile requests while the user zooms so previously requested context can progressively appear instead of being abruptly canceled.

Do not gate the field UI on MapLibre `idle`. The map is usable while raster tiles continue loading, and application SVG geometry has its own rendering path.

Do not prefetch whole areas or build an offline basemap cache. Only normal interactive viewport requests are allowed in the current architecture.

History:
- OpenFreeMap was the initial vector provider but the first production-origin test lost street-level detail.
- Standard OSM raster tiles restored availability but looked soft on high-DPI displays.
- VersaTiles produced a white map on the real production phone test.
- CARTO vector rendering was too slow/unpredictable on the tested mobile connection.
- CARTO Retina raster improved loading behavior.
- CARTO Voyager Retina is the current colorful, performance-oriented MVP basemap.

## SVG application overlay

The overlay projects stored longitude/latitude coordinates into the current MapLibre screen projection and redraws as the map pans, zooms or resizes.

### Area behavior

- every stored area is a GeoJSON Polygon assigned to exactly one team;
- fill and outline colors come from the assigned team;
- saved areas render together in SVG with transparent fills and strong outlines;
- the selected area receives the existing high-contrast treatment plus a visible marker at every stored corner;
- drawing renders SVG point markers and connecting/polygon geometry immediately;
- editing renders the preview and large edit points in SVG;
- area selection uses application point-in-polygon hit testing rather than MapLibre rendered-feature queries;
- edit-vertex selection uses application screen-distance hit testing;
- polygon geometry is validated before Save is enabled and again by the Worker before D1 persistence.

### Street Mode behavior

- every street task is a GeoJSON LineString assigned to one area;
- the line inherits the area's team color for ownership context;
- saved street tasks render as SVG polylines;
- status uses width/opacity/dash treatment in addition to team color:
  - `open`: strong solid line;
  - `completed`: thinner/faded solid line;
  - `later`: dashed line;
  - `not-deliverable`: dotted line;
- selected streets receive the existing SVG selection halo;
- manual street tracing renders SVG draft LineString geometry and point markers;
- street selection uses application screen-distance hit testing;
- street status changes happen through explicit UI controls, never through map panning.

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

Field behavior is one-shot centering, not continuous camera tracking. Pressing the location control may center the map on the current device location. After that, panning and zooming are fully manual until the user presses the location control again.

Rules:
- permission is user initiated;
- location is not written to browser campaign data or Worker/D1;
- no route history is created;
- map use remains possible when permission is denied.

## Persistence independence

The SVG overlay consumes the current in-memory campaign snapshot regardless of whether that snapshot originated from localStorage or Worker/D1. Synchronization must never make rendering depend directly on network availability.

## Offline/connectivity behavior

The project is website-only and does not use a PWA service worker. M3 keeps the last known snapshot in localStorage and retries ordinary in-page synchronization. M5 may add a durable mutation queue without changing this renderer or bulk-caching map tiles.

## Future OSM import

A bounded import can later create task snapshots from OpenStreetMap/Overpass data. Imported task geometry must be stored as campaign data rather than relying permanently on mutable upstream OSM object state.

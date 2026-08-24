---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture, product-ux, architecture-security]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary, map-camera]
---

# Map Architecture

## Renderer boundary

The production-phone stability phase established the current map architecture and it remains a release gate.

MapLibre GL JS renders only:
- the CARTO Voyager Retina raster basemap;
- navigation/compass controls;
- camera movement and arbitrary bearing/rotation;
- local one-shot browser geolocation display.

All Verteil-Flyer application geometry is rendered by the independent SVG overlay above the MapLibre canvas:
- saved team areas;
- saved street tasks;
- area-draw geometry and points;
- street-draw geometry and points;
- area-edit preview geometry and edit points;
- selected-street highlight.

Do **not** reintroduce MapLibre application GeoJSON sources/layers for this geometry without a new accepted decision and real-browser acceptance. PR #19 attempted a wholesale saved-geometry move into MapLibre WebGL and failed real-browser visibility/interactivity acceptance despite green CI, so it was closed without merge.

## Basemap

Primary MVP provider:

CARTO Voyager Retina raster tiles:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The source uses four CARTO CDN hostnames and 2x-resolution tiles. Voyager remains preferred because it provides readable road hierarchy, green spaces and water while retaining the simpler Retina-raster loading path.

The basemap provider is an operational dependency, not a domain dependency. Keep it isolated and replaceable.

The Voyager labels are pre-rendered into raster tiles. Application language switching therefore translates Verteil-Flyer UI and ARIA text but cannot dynamically translate provider-rendered basemap labels. Do not replace the stable mobile basemap merely to force label localization.

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

The overlay consumes stored longitude/latitude geometry and projects it into the current MapLibre screen projection.

### Browse performance path

Saved geometry stays in SVG, but ordinary browse pan/zoom/rotate must not cause a full React reconciliation of one SVG node per stored feature.

The optimized browse renderer therefore:
- groups saved Areas by Team color into a small number of SVG `path` elements;
- groups saved Street Tasks by Team color + task status into a small number of SVG `path` elements;
- keeps geometric Area/Street hit testing independent from the rendered SVG node count;
- updates the grouped path `d` attributes imperatively from MapLibre camera events;
- coalesces saved-geometry redraws to one animation-frame callback;
- culls geometry whose geographic bounding box is outside the current map viewport before doing expensive point projection;
- updates line widths from the current zoom so saved streets become visually thinner while zooming out.

This removes React reconciliation and hundreds of individual saved-feature DOM writes from the hot camera-movement path while retaining the renderer that has already proven reliable in real browsers.

The projection work itself is still proportional to the number of visible vertices. Whole-city acceptance therefore still requires synthetic density testing and real-device checks rather than assuming unlimited scale.

### Active draw/edit path

Active draw/edit geometry remains a separate SVG overlay with the established direct redraw behavior. It is deliberately **not** animation-frame throttled by the saved-geometry optimization because a previous experiment made real-device editing noticeably more laggy.

### Area behavior

- every stored area is a GeoJSON Polygon assigned to exactly one team;
- fill and outline colors come from the assigned team;
- saved areas use a subtle transparent Team-color fill and a thin Team-color outline;
- **browse selection intentionally has no extra white halo and no stored-corner markers**; the detail/bottom sheet is the selection indication;
- area corner markers appear only while the user is actively editing that Area;
- drawing renders SVG point markers and connecting/polygon geometry immediately;
- editing renders a high-contrast preview outline plus large touch-friendly edit points in SVG;
- the selected edit vertex is visually distinct;
- area selection uses application point-in-polygon hit testing rather than MapLibre rendered-feature queries;
- edit-vertex selection uses application screen-distance hit testing;
- polygon geometry is validated before Save is enabled and again by the Worker before D1 persistence.

The browse-selection rule above deliberately supersedes the earlier M1/M2 behavior where selection added a white polygon halo and markers at every stored corner.

### Street Mode behavior

- every street task is a GeoJSON LineString assigned to one area;
- the line inherits the area's team color for ownership context;
- saved street tasks are drawn as thin Team-colored road-like SVG strokes without a permanent broad white highlighter casing;
- saved stroke width interpolates with map zoom so city overview lines are much thinner than street-level lines;
- status uses opacity/dash treatment in addition to team color:
  - `open`: strong solid line;
  - `completed`: faded solid line;
  - `later`: dashed line;
  - `not-deliverable`: dotted line;
- only the selected street receives a compact dark selection halo;
- manual street tracing keeps the established high-contrast draft line and point markers;
- street selection uses application screen-distance hit testing;
- street status changes happen through explicit UI controls, never through map panning.

Do not encode distribution state by editing the basemap itself.

## Interaction modes

The map has explicit browser-side modes:
- `browse`: pan/zoom/rotate and select stored areas or street tasks;
- `draw`: map taps add area polygon vertices; Save/Cancel/Undo are explicit;
- `edit`: stored area geometry remains unchanged until the edited preview is explicitly saved;
- `street-draw`: map taps trace a street LineString; Save/Cancel/Undo are explicit.

Double-click zoom is disabled in geometry-input modes to reduce accidental points while normal drag/pinch map navigation remains available.

Rotation is supported again:
- touch users may use normal two-finger MapLibre rotation;
- desktop users may use MapLibre's normal rotation gestures;
- no artificial 90-degree snapping is used;
- the compass is visible and may reset North-Up;
- SVG Areas, Streets, drafts and edit vertices must remain projected correctly at any bearing.

## Camera state

Campaign data and personal camera state are deliberately separate states.

A personal camera view contains at least:
- center longitude/latitude;
- zoom;
- bearing.

It is stored locally in the browser, keyed by Campaign, with debounced writes after completed camera movement. It is not sent to D1 merely because the user pans, zooms or rotates.

Camera startup priority is:
1. personal last camera view for this Campaign on this browser;
2. shared Campaign default map view (`defaultMapView` / Aktionsfokus);
3. Germany fallback.

The Campaign default map view is shared Campaign configuration and may be persisted in D1 by an Admin. A new browser with no personal camera can therefore open directly at the action location.

A remote Campaign snapshot update must **never** reset center, zoom or bearing, trigger GPS focusing, or force the Germany fallback. Snapshot refresh and camera state are independent.

## Geolocation

MapLibre's geolocation control may display the device's current location after browser permission is granted.

Field behavior is one-shot centering, not continuous camera tracking. Pressing the location control may center the map on the current device location. After that, panning, zooming and rotation are fully manual until the user presses the location control again.

Rules:
- permission is user initiated;
- GPS coordinates are not written into Campaign data or Worker/D1;
- no route history is created;
- no GPS history/trail is stored;
- map use remains possible when permission is denied.

## Persistence independence

The SVG overlay consumes the current in-memory Campaign snapshot regardless of whether that snapshot originated from localStorage or Worker/D1. Synchronization must never make rendering depend directly on network availability.

M4 replaces full-page sync reloads with in-memory snapshot replacement. The React snapshot can change while the MapLibre camera instance remains untouched.

## Offline/connectivity behavior

The project is website-only and does not use a PWA service worker. M4 keeps the last known snapshot in localStorage and performs ordinary in-page synchronization. M5 may add a durable mutation queue without changing this renderer or bulk-caching map tiles.

## Future OSM import

A bounded import can later create task snapshots from OpenStreetMap/Overpass data. Imported task geometry must be stored as Campaign data rather than relying permanently on mutable upstream OSM object state.

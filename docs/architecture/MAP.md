---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture, product-ux, architecture-security, adr-0010-hybrid-map-renderer]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary, map-camera]
---

# Map Architecture

## Renderer boundary

The map uses a hybrid renderer optimized for whole-city field use.

MapLibre GL JS renders:
- the CARTO Voyager Retina raster basemap;
- navigation/compass controls;
- camera movement and arbitrary bearing/rotation;
- local one-shot browser geolocation display;
- **saved Team Areas** through a GeoJSON source and fill/outline layers;
- **saved Street Tasks** through a GeoJSON source and a small fixed set of line layers;
- saved-geometry browse hit testing.

The independent SVG overlay renders only short-lived interaction geometry:
- Area-draw geometry and points;
- Street-draw geometry and points;
- Area-edit preview geometry and edit points.

This supersedes the earlier stability rule that all application geometry had to stay in SVG. The reason is measured/visible mobile behavior: persistent SVG geometry showed a small camera-follow delay even with a small dataset, while a whole-city Campaign may contain hundreds or thousands of Street Tasks. Persistent geometry now stays in MapLibre's WebGL render loop so it remains locked to the basemap while panning, zooming and rotating.

The domain model remains ordinary GeoJSON and does not depend on MapLibre. Persistence, authorization and synchronization remain renderer-independent.

## Basemap

Primary provider:

CARTO Voyager Retina raster tiles:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The source uses four CARTO CDN hostnames and 2x-resolution tiles. Voyager remains preferred because it provides readable road hierarchy, green spaces and water while retaining the simpler Retina-raster loading path.

The basemap provider is an operational dependency, not a domain dependency. Keep it isolated and replaceable.

Voyager labels are pre-rendered into raster tiles. Application language switching translates Verteil-Flyer UI and ARIA text but cannot dynamically translate provider-rendered basemap labels.

### Mobile loading behavior

MapLibre keeps pending lower-zoom tile requests while the user zooms so previously requested context can progressively appear instead of being abruptly canceled.

Do not gate the field UI on MapLibre `idle`. The map is usable while raster tiles continue loading.

Do not prefetch whole areas or build an offline basemap cache. Only normal interactive viewport requests are allowed.

History:
- OpenFreeMap was the initial vector provider but the first production-origin test lost street-level detail.
- Standard OSM raster tiles restored availability but looked soft on high-DPI displays.
- VersaTiles produced a white map on the real production phone test.
- CARTO vector rendering was too slow/unpredictable on the tested mobile connection.
- CARTO Retina raster improved loading behavior.
- CARTO Voyager Retina is the current colorful, performance-oriented basemap.

## Saved Area rendering

Every stored Area is a GeoJSON Polygon assigned to exactly one Team.

Saved Areas are collected into one MapLibre GeoJSON source. A small fixed layer set renders:
- a very low-opacity Team-colored fill;
- a crisp Team-colored boundary.

The Area styling deliberately avoids a broad highlighter appearance. Ownership should remain visible without washing out the underlying street map.

Area outline width is zoom-dependent. It becomes thinner as the user zooms out and gradually wider at street-level zoom. This keeps a whole-city overview readable rather than turning distant Areas into thick blobs.

Browse selection intentionally has:
- no white polygon halo;
- no stored-corner markers;
- no edit handles.

The detail/bottom sheet remains the browse-selection indication.

Area selection in browse mode uses MapLibre rendered-feature hit testing on the saved fill layer.

## Saved Street rendering

Every Street Task is a GeoJSON LineString assigned to one Area and inherits the Area Team color.

All saved Street Tasks are collected into one MapLibre GeoJSON source. A small fixed set of line layers renders status groups instead of creating separate React/SVG DOM elements for every visual pass.

The normal saved Street visual is the **colored street line itself**. There is no permanent broad white casing underneath every street.

Street width is zoom-dependent:
- very thin in city overview;
- gradually wider as the user zooms toward street level;
- never stays visually oversized while zooming out.

Status remains visible without relying only on color:
- `open`: clear solid Team-colored line;
- `completed`: faded Team-colored line;
- `later`: dashed Team-colored line;
- `not-deliverable`: short dotted/dashed Team-colored treatment.

A selected Street may receive a temporary white selection halo. The halo is selection feedback only and is not part of the normal city rendering.

Street browse selection uses MapLibre `queryRenderedFeatures` with a touch-friendly screen-space tolerance around the tap.

## Active SVG editing overlay

SVG remains intentionally used for active editing because the number of active vertices is small and touch handles are UI rather than persistent map content.

### Area draw

- map taps add draft polygon vertices;
- current draft line/polygon is rendered immediately in SVG;
- draft points are visible and touch-friendly;
- Save/Cancel/Undo remain explicit.

### Area edit

- the stored Area remains unchanged until Save;
- the edit preview is high contrast;
- edit points are shown **only while the Area is actively being edited**;
- the selected edit vertex is visually distinct;
- edit-vertex selection uses screen-distance hit testing;
- no edit point is rendered merely because an Area is selected or saved.

### Street draw

- map taps trace the draft LineString;
- only the active draft and its draft points use SVG;
- after Save the Street moves into the saved MapLibre source/layers.

Because active SVG contains only the current draft/edit geometry, camera movement may trigger SVG reprojection in these modes without scaling cost with the total number of saved city features.

## Performance rules

Normal `browse` pan/zoom/rotate must not trigger React rerenders solely to reposition saved Areas or Streets.

Saved geometry is updated only when its underlying Campaign data changes, not for every camera frame.

Performance validation should include synthetic datasets with at least:
- 500 Street Tasks;
- 1,000 Street Tasks;
- 2,500 Street Tasks;
- 5,000 Street Tasks.

Real-device acceptance should include the current Pixel 9 reference and, when available, older iPhone-class hardware. Visual lock-step between basemap and saved geometry is a release criterion.

Do not introduce one MapLibre layer per Street. Keep layer count small and represent differences through feature properties, filters and data-driven paint expressions.

## Interaction modes

The map has explicit browser-side modes:
- `browse`: pan/zoom/rotate and select saved Areas or Street Tasks;
- `draw`: map taps add Area polygon vertices;
- `edit`: stored Area remains unchanged until its SVG preview is explicitly saved;
- `street-draw`: map taps trace a Street LineString.

Double-click zoom is disabled in geometry-input modes to reduce accidental points while normal drag/pinch map navigation remains available.

Rotation is supported:
- touch users may use normal two-finger MapLibre rotation;
- desktop users may use normal MapLibre rotation gestures;
- no artificial 90-degree snapping;
- compass remains visible and can reset North-Up;
- saved WebGL geometry follows the camera in MapLibre's render loop;
- active SVG draft/edit geometry must remain projected correctly at arbitrary bearing.

## Camera state

Campaign data and personal camera state remain deliberately separate.

A personal camera view contains:
- center longitude/latitude;
- zoom;
- bearing.

It is stored locally in the browser, keyed by Campaign, with debounced writes after completed camera movement. It is not sent to D1 merely because the user pans, zooms or rotates.

Camera startup priority:
1. personal last camera view for this Campaign on this browser;
2. shared Campaign default map view (`defaultMapView` / Aktionsfokus);
3. Germany fallback.

A remote Campaign snapshot update must never reset center, zoom or bearing, trigger GPS focusing, or force the Germany fallback.

## Geolocation

MapLibre's geolocation control may display the device's current location after browser permission is granted.

Field behavior is one-shot centering, not continuous camera tracking. After centering, panning, zooming and rotation remain manual until the user invokes location again.

Rules:
- permission is user initiated;
- GPS coordinates are not written into Campaign data or Worker/D1;
- no route history is created;
- no GPS history/trail is stored;
- map use remains possible when permission is denied.

## Persistence independence

The renderer consumes the current in-memory Campaign snapshot regardless of whether it came from localStorage or Worker/D1.

Synchronization must never make rendering depend directly on network availability. Remote snapshot replacement can update saved MapLibre sources while the camera instance remains untouched.

## Offline/connectivity behavior

The project is website-only and does not use a PWA service worker. The last known snapshot remains locally available. A future durable mutation queue may improve write reliability without changing the basemap cache policy.

## Future OSM import

A bounded import can later create Street Tasks from OpenStreetMap/Overpass data. Imported geometry must be persisted as Campaign data rather than permanently depending on mutable upstream OSM object state.

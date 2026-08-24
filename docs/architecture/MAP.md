---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture, product-ux, architecture-security]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary, map-camera]
---

# Map Architecture

## Renderer boundary

MapLibre GL JS owns the persistent map rendering pipeline:
- CARTO Voyager Retina raster basemap;
- camera movement, zoom and bearing;
- navigation/compass controls;
- one-shot browser geolocation display;
- saved Verteil-Flyer Areas through one GeoJSON source plus Fill/Outline layers;
- saved Street Tasks through one GeoJSON source plus a small fixed set of Line layers.

The independent SVG overlay is reserved for **active geometry input only**:
- Area draw preview and points;
- Area edit preview and edit handles;
- Street draw preview and points.

Stored edit/corner points are never shown in browse mode.

ADR-0010 defines the saved-geometry lifecycle. The renderer follows the same architectural pattern used by dense GL map applications such as MetroDreamin: long-lived sources/layers, `setData()` on actual domain changes, and no application projection loop during ordinary map movement.

## Basemap

Primary MVP provider is CARTO Voyager Retina raster:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The provider remains an operational dependency rather than a domain dependency. Labels are pre-rendered into raster tiles, so UI language switching does not translate basemap labels.

MapLibre must not gate field UI on map `idle`. Normal viewport tile requests may continue while the application remains usable. There is no whole-area tile prefetch or offline basemap cache.

## Saved application GeoJSON

### Sources

Exactly two long-lived application sources are used:
- `vf-areas` — all saved Areas for the current Campaign;
- `vf-streets` — all saved Street Tasks for the current Campaign.

Sources are created once after MapLibre's `load` event. They are not recreated during pan/zoom/rotate.

When Campaign data changes, the existing `GeoJSONSource` receives `setData()` with the latest in-memory feature collection. If data changes before map load finishes, the load callback reads the latest ref and initializes the source with the newest data.

Do not use a `styledata -> setData()` feedback loop.

### Area layers

- `vf-areas-fill`: subtle Team-color fill;
- `vf-areas-outline`: thin Team-color outline.

Area outline width uses a zoom expression so overview lines become visually thinner while zooming out. Browse selection intentionally adds no white halo and no stored corner markers.

### Street layers

Saved Street Tasks share one source and a constant number of layers:
- selected-street halo;
- `open`;
- `completed`;
- `later`;
- `not-deliverable`.

Each feature carries its Team color and status as properties. Layers filter by status, read the Team color from feature data, and use zoom expressions for width.

Street styling must remain road-like rather than highlighter-like:
- thin Team-color stroke;
- no permanent broad white casing;
- `completed` is faded;
- `later` is dashed;
- `not-deliverable` is dotted/dashed more sparsely;
- only the selected Street gets a compact dark halo.

The number of MapLibre sources/layers therefore stays essentially constant whether the Campaign has 10, 500, or several thousand Street Tasks.

## Browse interaction

Saved geometry selection is handled by MapLibre rendered-feature queries rather than application-wide screen projection loops.

For Streets, the click point is expanded to a small screen-space bounding box before `queryRenderedFeatures()` so a thin visible line still has a comfortable touch target.

For Areas, the Area fill layer is queried at the tap point.

This is intentionally similar to MetroDreamin's GL interaction pattern and avoids scanning/projecting every saved Street on each click or camera frame.

## Active draw/edit SVG

Active draw/edit geometry stays SVG because the number of active vertices is small and touch editing benefits from explicit DOM handles.

The active overlay is updated imperatively on MapLibre camera movement:
- polygon/polyline `points` attributes are reprojected;
- visible edit/draw marker `cx/cy` values are updated;
- React is not forced to reconcile the active geometry tree for every map `move` event.

### Area behavior

- every stored Area is a GeoJSON Polygon assigned to exactly one Team;
- Team color drives saved fill/outline;
- browse mode shows no stored corner points;
- drawing shows point markers and a live polygon/polyline preview;
- editing shows high-contrast preview geometry and touch-friendly points;
- the selected edit vertex is visually distinct;
- polygon geometry is validated before save and again by the Worker.

### Street Mode behavior

- every Street Task is a GeoJSON LineString assigned to one Area;
- the line inherits the Area Team color;
- drawing uses a temporary high-contrast SVG draft and points;
- save converts the draft into normal saved GeoJSON data;
- status changes occur through explicit UI controls, never through map movement.

## Performance rule

Ordinary browse pan/zoom/rotate must perform **zero Verteil-Flyer `map.project()` loops for saved Areas/Streets**. MapLibre/WebGL moves the basemap and saved geometry together in the same render pipeline.

`setData()` work is allowed only for actual Campaign/sync mutations. Whole-city acceptance still requires real-device and synthetic tests at 500 / 1,000 / 2,500 / 5,000 Street Tasks.

The opt-in `?diag=1` panel is used for real-browser acceptance and must identify the renderer as `maplibre-geojson`.

## Camera state

Campaign default focus and personal camera state remain separate.

A personal camera view contains center, zoom and bearing and is stored locally per Campaign. Startup priority is:
1. personal last camera view;
2. Campaign default map view;
3. Germany fallback.

Remote Campaign synchronization must never reset the personal camera.

## Rotation and geolocation

Normal MapLibre bearing/rotation remains enabled with the compass visible. Active SVG edit/draw geometry must remain correctly projected at arbitrary bearing.

The geolocation control is user initiated and one-shot. GPS coordinates are not persisted into Campaign data, route history or analytics.

## History

Earlier phases used a full saved SVG overlay because it was reliable while the basemap stack was being stabilized. A first MapLibre application-layer experiment in PR #19 failed because its source/layer lifecycle raced real-browser style readiness and saved geometry disappeared. A grouped-SVG and Canvas follow-up reduced some overhead but still retained JavaScript projection work during camera movement.

ADR-0010 replaces those experiments with the long-lived-source lifecycle described above. The key change is not merely "use WebGL"; it is that saved application rendering is owned permanently by MapLibre after the `load` event and only receives data updates when domain data changes.

## Persistence independence

The map consumes the current in-memory Campaign snapshot regardless of whether it originated from localStorage or Worker/D1. Rendering never depends directly on network availability.

The website remains website-only: no service worker, no PWA and no offline basemap cache. A future durable mutation queue may change synchronization without changing this renderer boundary.

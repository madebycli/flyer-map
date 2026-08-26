---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-26
related: [architecture, product-ux, architecture-security, product-roadmap, ADR-0012, ADR-0013]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary, map-camera, saved-geometry-renderer, prepared-offline-map-rendering]
---

# Map Architecture

## Current renderer baseline

MapLibre GL JS **5.7.1** owns the persistent map rendering pipeline:
- CARTO Voyager Retina raster basemap;
- camera movement, zoom and bearing;
- navigation/compass controls;
- one-shot browser geolocation display;
- saved Verteil-Flyer Areas through one GeoJSON source plus Fill/Outline layers;
- saved Street Tasks through one GeoJSON source plus a small fixed set of Line layers.

The independent SVG overlay is reserved for active geometry input only:
- Area draw preview and points;
- Area edit preview and edit handles;
- Street draw preview and points.

Stored edit/corner points are never shown in browse mode.

ADR-0010 defines this saved-vs-active rendering boundary.

## Why MapLibre is pinned to 5.7.1

A tested upgrade to MapLibre GL JS 6.4.1 produced a real-browser GeoJSON regression in this project: the basemap rendered and frame rate stayed healthy, while saved application GeoJSON became invisible and non-interactive.

The current working baseline therefore pins 5.7.1. Do not upgrade MapLibre casually. Any runtime upgrade requires browser acceptance that proves:
- saved Area visible;
- saved Street visible;
- Area selectable;
- Street selectable;
- browse pan/zoom/rotate remains visually locked and performant.

Green TypeScript/CI alone is insufficient for a map-runtime upgrade.

## Basemap

Primary online provider is CARTO Voyager Retina raster:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The provider remains replaceable. Labels are provider-rendered raster content and are not dynamically translated by application language.

Current zoom contract:
- CARTO raster source `maxzoom` = 20;
- Map instance `maxZoom` = 20;
- raster style layer must remain visible at zoom 20, so its layer `maxzoom` must be greater than 20 (currently 21) or omitted.

Do not set the raster layer `maxzoom` back to 20: MapLibre hides a style layer at zoom values equal to or greater than its layer maxzoom, which caused a real-browser white-basemap regression at maximum zoom.

CARTO Basemap content is **online-only** in the current architecture. CARTO Basemap terms prohibit storing/saving/caching map content, so deliberate offline-map downloads must not cache these raster tiles.

ADR-0012 defines the separate prepared offline-data path. OpenStreetMap Foundation raster/vector tile services also must not be bulk-prefetched for this feature.

## Saved application GeoJSON

### Sources

Two persistent sources exist for the current Campaign:
- `vf-areas` - all saved Areas;
- `vf-streets` - all saved Street Tasks.

The initial MapLibre style is built with these application sources/layers already present using the latest Campaign data available at map construction time. They are not recreated during pan/zoom/rotate.

Actual Campaign data changes update the existing `GeoJSONSource` data with `setData()`.

Do not use `styledata -> setData()` feedback loops.

### Area layers

- `vf-areas-fill` - subtle Team-color fill;
- `vf-areas-outline` - thin Team-color outline.

Browse selection adds no white edit halo and no stored corner markers.

### Street layers

Saved Street Tasks share one source and a constant small layer set:
- selected-street treatment;
- open;
- completed;
- later;
- not-deliverable.

Feature properties carry Team color/status. Line width is zoom-dependent and should remain road-like rather than highlighter-like.

The number of sources/layers stays effectively constant whether a Campaign contains 10 or thousands of Street features.

ADR-0013 does not create a second renderer path. A persisted Smart Street becomes the same saved Campaign Street feature after its reviewed OSM-derived route is copied into a validated LineString snapshot. OSM provenance is metadata and is not needed to render the saved Street.

## Browse interaction

Saved selection uses MapLibre rendered-feature queries.

Street selection uses a small screen-space hit box around the pointer/tap so a thin line remains easy to select.

Area selection queries the Area fill layer at the interaction point.

Normal browse movement must perform **zero Verteil-Flyer `map.project()` loops over all saved Areas/Streets**.

## Active draw/edit SVG

Active geometry remains SVG because active vertex counts are small and explicit DOM handles work well for touch editing.

During active draw/edit, map movement imperatively reprojects only the active points/preview.

### Area behavior

- stored Area = GeoJSON Polygon assigned to one Team;
- Team color drives saved fill/outline;
- browse shows no vertices;
- draw/edit shows temporary explicit vertices;
- geometry validated client-side and Worker-side.

### Current Street fallback

Manual Street Task drawing stores a GeoJSON LineString assigned to an Area and remains available as a fallback.

ADR-0013 confirms the Smart Street primary direction:
- user chooses precise snapped start/end anchors on prepared OSM road geometry;
- ambiguity is resolved through explicit route candidates and optional waypoints;
- street names are display metadata only;
- the reviewed selected route is clipped/stiched into one Campaign-owned LineString snapshot;
- first/last source ways are clipped exactly at the reviewed anchors;
- multi-way source coordinate order may be reversed for continuity;
- a non-continuous route is rejected instead of silently stored as `MultiLineString`;
- later OSM refreshes do not silently rewrite the saved geometry.

The Workbench persistence stack keeps the renderer contract unchanged: after creation, a Smart Street is just another saved Street Task in `vf-streets`.

## Prepared offline working area

ADR-0012 is accepted with the bounded raw OSM subset approach.

Initial direction:
- user deliberately prepares approximately 3 km around the current map center;
- browser requests the bounded package through the existing Worker;
- Worker owns fixed Overpass-compatible query templates, validates radius/limits and keeps the upstream server-configurable;
- normalized versioned JSON/GeoJSON preserves relevant OSM object identity/tags;
- browser IndexedDB stores the package locally;
- local roads/buildings/context render through batched MapLibre sources/layers while the already-loaded website is offline;
- Campaign Areas/Streets remain above the local context and retain the existing selection/edit boundary;
- the same prepared OSM identity/data feeds Smart Street source candidates while application-owned Task identity remains separate under ADR-0013;
- no CARTO or OpenStreetMap Foundation tile bulk cache;
- no Service Worker/PWA requirement;
- no R2/PMTiles pipeline in v1.

The first local offline style should remain deliberately small rather than attempting to reproduce the complete CARTO visual basemap. Required OSM attribution must remain visible.

## Smart Street + House constraints

Road/building import must preserve the persistent renderer pattern:
- imported/generated saved features belong in map data sources/layers;
- do not create one React/SVG DOM element or one MapLibre layer per Street/House;
- whole-city geometry requires source/layer batching and real-device tests;
- reuse the accepted ADR-0012 OSM identity/data direction;
- use application-owned durable Task ids and reviewed geometry snapshots under ADR-0013;
- if a different production-scale map pipeline becomes necessary, decide it explicitly rather than silently creating a duplicate source of truth.

House persistence remains a later explicit schema slice and is not implied by the current Street-only Task table.

## Camera state

Campaign default focus and personal camera state are separate.

Startup priority:
1. personal last camera view;
2. Campaign default map view;
3. Germany fallback.

Remote synchronization must never reset the personal camera.

## Rotation and geolocation

Normal bearing/rotation stays enabled with a compass. Active SVG geometry must remain aligned at arbitrary bearing.

Geolocation is user-initiated and one-shot. GPS coordinates are not persisted as route history or statistics.

## Diagnostics/performance acceptance

The opt-in `?diag=1` panel is used for renderer troubleshooting and real-browser acceptance.

Whole-city acceptance must include representative dense tests, currently targeted at 500 / 1,000 / 2,500 / 5,000 Street features. House Mode will require additional building-scale tests.

Prepared 3 km offline packages must be measured with dense representative urban data on real mobile devices. If normalized GeoJSON package/render size becomes unsuitable, revisit transport/render storage through a new ADR rather than silently introducing a second map pipeline.

## Persistence independence

The map consumes the current in-memory Campaign state regardless of whether it came from local cache or Worker/D1. Rendering does not directly depend on network availability.

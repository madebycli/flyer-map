---
id: architecture-map
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture, product-ux, architecture-security, product-roadmap]
source_of_truth_for: [basemap, geolocation-display, map-layer-boundary, map-camera, saved-geometry-renderer]
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

Primary provider is CARTO Voyager Retina raster:

`https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`

The provider remains replaceable. Labels are provider-rendered raster content and are not dynamically translated by application language.

There is no whole-area offline tile cache or service worker.

## Saved application GeoJSON

### Sources

Two persistent sources exist for the current Campaign:
- `vf-areas` — all saved Areas;
- `vf-streets` — all saved Street Tasks.

The initial MapLibre style is built with these application sources/layers already present using the latest Campaign data available at map construction time. They are not recreated during pan/zoom/rotate.

Actual Campaign data changes update the existing `GeoJSONSource` data with `setData()`.

Do not use `styledata -> setData()` feedback loops.

### Area layers

- `vf-areas-fill` — subtle Team-color fill;
- `vf-areas-outline` — thin Team-color outline.

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

Current manual Street Task drawing stores a GeoJSON LineString assigned to an Area. This remains available as a fallback.

It is **not** the desired long-term primary workflow. M6 plans actual road/building selection from reviewed OSM/OSM-derived geometry. See `docs/product/ROADMAP.md`.

## Smart Street + House future constraints

Future road/building import must preserve the persistent renderer pattern:
- imported/generated saved features belong in map data sources/layers;
- do not create one React/SVG DOM element or one MapLibre layer per Street/House;
- whole-city geometry requires source/layer batching and real-device tests;
- choose OSM provider/caching/licensing deliberately before implementation.

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

## Persistence independence

The map consumes the current in-memory Campaign state regardless of whether it came from local cache or Worker/D1. Rendering does not directly depend on network availability.

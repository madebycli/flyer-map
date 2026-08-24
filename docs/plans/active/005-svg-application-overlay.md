# Plan 005 — Independent SVG Application Overlay

## Goal

Bypass the unreliable MapLibre application-GeoJSON render path observed on the production phone. Keep MapLibre only for the CARTO basemap, navigation and geolocation while rendering all campaign geometry in a separate SVG overlay synchronized to the current map projection.

## Field finding

Repeated production-phone tests after PRs #11 and #12 still showed no application geometry at all: no area points, no saved area polygons, no selection outline and no street lines, while the raster basemap itself remained visible.

## Tasks

- [x] remove application geometry from the MapLibre style/runtime layer path
- [x] render saved areas as SVG polygons above the map canvas
- [x] render saved streets as SVG polylines with status-specific width/opacity/dashes
- [x] render area-draw points and geometry in SVG
- [x] render street-draw points and geometry in SVG
- [x] render edit geometry and edit points in SVG
- [x] render a marker at every stored polygon vertex when an area is selected
- [x] keep selected-area white halo and team-color outline in SVG
- [x] keep selected-street outer halo in SVG
- [x] resync SVG projection while map pans, zooms and resizes
- [x] move area selection to point-in-polygon hit testing instead of MapLibre rendered-feature queries
- [x] move street selection to screen-distance hit testing instead of MapLibre rendered-feature queries
- [x] move edit-vertex selection to screen-distance hit testing
- [x] pass CI typecheck/build on implementation head `43be99c84b231de253d07399f58567b8c389d868` (run #57)
- [ ] verify on the production phone

## Acceptance criteria

- First area-draw tap immediately shows a visible SVG marker.
- Second area-draw tap shows two markers and a visible connecting line.
- Third area-draw tap shows a visible polygon.
- Saved areas remain visible while panning and zooming.
- Selecting a saved area shows a strong outline plus one marker for every stored corner.
- Street drawing and saved street tasks remain visible while panning and zooming.
- Tapping visible saved areas and streets opens their existing management UI without relying on MapLibre application layers.
- CARTO Voyager Retina, one-shot geolocation and compact field UI remain unchanged.

## Constraints

- Website only; no native app/PWA/service worker.
- GPS remains local-only.
- No D1 binding or shared synchronization in this stability pass.

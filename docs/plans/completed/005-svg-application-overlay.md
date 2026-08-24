# Plan 005 — Independent SVG Application Overlay

Status: completed on 2026-08-24.

## Goal

Bypass the unreliable MapLibre application-GeoJSON rendering path while keeping MapLibre for the CARTO basemap, navigation and local geolocation.

## Completed outcome

- saved areas render as SVG polygons above the MapLibre canvas
- saved streets render as SVG polylines with status styling
- area/street/edit draft geometry and points render in SVG
- every stored area corner receives a marker while the area is selected
- SVG projection updates while panning, zooming and resizing
- area selection uses application point-in-polygon hit testing
- street and edit-vertex selection use application screen-distance hit testing
- CARTO Voyager Retina and one-shot local geolocation remain unchanged
- PR #13 passed CI and was merged to `main`

## Production-phone acceptance

The subsequent real-phone check confirmed the release gate: areas, streets, draft geometry and selected-area corner markers are visible on the actual device. The stability phase is therefore accepted and M3 may proceed.

## Permanent release gate

Later milestones must preserve this boundary:
- no MapLibre application GeoJSON layers;
- MapLibre renders only CARTO Voyager Retina, navigation and local GPS display;
- application geometry remains in the independent SVG overlay.

Broader Android/iPhone browser hardening remains an M6 release task.

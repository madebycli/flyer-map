---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M2 functionality exists, but repeated production-phone tests still show a blocking application-geometry rendering failure. Plan 005 replaces the MapLibre application-layer path with an independent SVG overlay and is the current release gate.

## Working in code

The mobile workflow includes:
- editable named/color-coded teams
- editable team areas with local browser persistence
- manually traced street LineString tasks assigned to an area
- task states `open`, `completed`, `later`, `not-deliverable`
- immediate task-status Undo
- MapLibre with CARTO Voyager Retina basemap
- local-only one-shot browser geolocation
- compact field UI without the previous persistent title/online header
- primary + backup local browser snapshots

Cloudflare Workers Builds remains connected to `main` and the production/test deployment is:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

## Production-phone finding

PRs #11 and #12 passed CI but production-phone testing still showed the raster basemap with no application geometry: no area draft points, no saved areas, no selected-area outline and no street lines.

Further MapLibre GeoJSON/layer tuning is therefore not the primary fix path.

## Current stability direction

Plan 005 changes the application map boundary:
- MapLibre renders only the basemap, navigation controls and local geolocation display;
- saved areas render as an independent SVG overlay above the map canvas;
- saved streets render in the same SVG overlay;
- area/street/edit draft points and geometry also render in SVG;
- the SVG projection is recalculated on map pan, zoom and resize;
- selecting an area uses application point-in-polygon hit testing instead of MapLibre feature queries;
- selecting a street uses application screen-distance hit testing;
- edit vertex selection uses application screen-distance hit testing;
- every stored area corner receives a visible marker when that area is selected.

## Architecture constraints

- normal mobile-first website only
- no native app, PWA, service worker or Web App Manifest
- GPS remains local-only; no route recording or location history
- CARTO Voyager Retina remains the basemap
- browser persistence remains single-device only, not synchronization
- no production D1 id has been invented or bound

## Verification

Plan 005 must pass TypeScript typecheck and production build, then be tested on the production phone. No D1/House Mode work should proceed until the first area-draw point is visibly rendered on the real device.

## Active plans

- `docs/plans/active/002-m1-campaign-team-areas.md` — real-device acceptance blocked
- `docs/plans/active/003-m2-street-mode.md` — real-device acceptance blocked
- `docs/plans/active/004-mobile-map-stability.md` — previous stability pass, not field accepted
- `docs/plans/active/005-svg-application-overlay.md` — current blocker/release gate

## Not connected yet

- production D1 database/binding
- shared campaign state across devices
- authorization/access links
- resilient durable mutation queue
- OSM street import/snap-to-road
- House Mode

## Next

1. Pass CI for Plan 005.
2. Merge to `main` for the normal Cloudflare deployment.
3. On the phone: start area drawing and confirm the first tap immediately creates a visible marker.
4. Confirm second/third taps create line/polygon geometry.
5. Save and select the area; confirm all stored corners show markers.
6. Draw/save a street and confirm the line remains visible while panning/zooming.
7. Only after those checks continue the roadmap.

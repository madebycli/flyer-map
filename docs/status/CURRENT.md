---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M2 functionality exists, but production-phone verification exposed a blocking map-overlay/UI stability problem. Plan 004 is the current release gate before any further feature work.

## Working in code

The mobile map workflow includes:
- editable campaign and named/color-coded teams
- editable team areas with local browser persistence
- manually traced street LineString tasks assigned to an area
- task states `open`, `completed`, `later`, `not-deliverable`
- immediate task-status Undo
- MapLibre with CARTO Voyager Retina basemap
- local-only browser geolocation

Cloudflare Workers Builds is connected to `main` and the production/test deployment remains:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

## Production-phone findings

The latest real-device test reported:
- application geometry was not visible even though the basemap rendered;
- selected-area highlighting was therefore also not visible;
- area draw points/lines and Street Mode geometry were not visibly appearing;
- the centered `Karte lädt…` message remained visible;
- fixed top/bottom UI covered too much of the map;
- team/group persistence appeared unreliable in the observed flow;
- after pressing the location control, panning released location tracking but zoom-only interaction continued to be controlled by the tracked location.

These are treated as blockers. Do not add House Mode or D1 synchronization until the map interaction is reliable on the phone.

## Current stability changes

Plan 004 changes the implementation so:
- visible loading no longer waits for MapLibre `idle`;
- application sources/layers are installed independently, so one bad overlay layer cannot block every geometry source from receiving data;
- selected areas/tasks use dedicated GeoJSON sources;
- task statuses use dedicated simple sources/layers;
- task line hit-testing is enlarged for phone taps;
- geolocation is one-shot centering instead of continuous tracking;
- the persistent top title/campaign/online header is removed from the field UI;
- bottom controls and mode sheets are compressed to preserve map viewport;
- campaign snapshots use a primary local copy plus a local backup/fallback.

## Current architecture direction

- normal mobile-first website only
- no native app, PWA, service worker or Web App Manifest
- GPS remains local-only; no route recording or location history
- MapLibre remains the renderer
- CARTO Voyager Retina remains the basemap
- areas and street tasks remain application-controlled GeoJSON overlays
- browser snapshot persistence remains single-device only, not synchronization
- no production D1 id has been invented or bound

## Verification

Plans 002 and 003 previously passed CI for their implementation branches, but their real-device acceptance is not complete because the phone test found the overlay/rendering problems above.

Plan 004 must pass TypeScript typecheck and production build, then be verified on the production phone before M1/M2 can be considered field-usable.

## Active plans

- `docs/plans/active/002-m1-campaign-team-areas.md` — real-device acceptance blocked by Plan 004
- `docs/plans/active/003-m2-street-mode.md` — real-device acceptance blocked by Plan 004
- `docs/plans/active/004-mobile-map-stability.md` — current blocker/release gate

## Not connected yet

- production D1 database/binding
- shared campaign state across devices
- authorization/access links
- resilient durable mutation queue
- OSM street import/snap-to-road
- House Mode

## Next

1. Pass CI for Plan 004.
2. Deploy through the normal `main` Cloudflare build.
3. On the phone verify: saved area visibility, selected-area halo, live area drawing, live street drawing, saved street visibility and status changes.
4. Reload and verify teams/areas/tasks persist.
5. Press location once, then verify both pan and zoom remain manual until the location button is pressed again.
6. Only after those checks close Plans 002/003/004 and proceed to shared Worker/D1 persistence.

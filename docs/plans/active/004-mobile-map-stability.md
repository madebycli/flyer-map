# Plan 004 — Mobile Map Stability and Field UI

## Goal

Fix the production-phone failures reported after M1/M2: application geometry not appearing, the loading indicator remaining visible, local groups appearing unreliable across reloads, excessive fixed UI covering the map, and geolocation continuing to control zoom after the user wants to inspect the map manually.

## Field findings

- saved area/team colors were not visible on the production phone;
- selected-area highlighting was not visible because the application overlay path itself was not reliably becoming ready;
- Street Mode draft/saved lines were not visible;
- the centered `Karte lädt…` state remained visible too long;
- fixed top/bottom chrome covered too much of the map;
- team/group persistence appeared unreliable in the observed flow;
- MapLibre geolocation tracking released on pan but not on zoom, causing zoom interactions to snap back to the tracked location.

## Tasks

- [x] stop using the `idle` event as the visible map-loading completion gate
- [x] make application source/layer setup fail independently so one bad overlay layer cannot block all geometry updates
- [x] split selected-area and selected-task rendering into dedicated sources instead of depending on boolean feature filters
- [x] split task statuses into dedicated sources/layers for simpler and more resilient rendering
- [x] enlarge mobile task hit-testing around rendered street lines
- [x] keep area, draft-area, edit and street-draft overlays application-controlled above the basemap
- [x] change geolocation from continuous tracking to one-shot centering so subsequent pan or zoom is fully manual
- [x] remove the persistent top title/campaign/online chrome from the field UI
- [x] compress the normal toolbar, drawing controls, selected-area controls and task-status sheet
- [x] add a primary + backup local snapshot path and valid fallback loading
- [ ] run CI typecheck/build and fix any failures
- [ ] verify production-phone geometry rendering, local persistence and geolocation interaction after deployment

## Acceptance criteria

- Existing saved areas visibly render with team-colored fill/outline after map load.
- Selecting an area visibly adds a strong contrast outline.
- Area drawing visibly shows points/lines before save.
- Street drawing and saved street tasks visibly render.
- A failure in one optional application layer does not prevent the remaining application layers from receiving data.
- No centered loading badge remains after the base map style is ready.
- Pressing the location control centers on the device once; zooming or panning afterwards does not snap back until the control is pressed again.
- The persistent top title/online header is absent.
- Idle map controls occupy only a compact strip near the bottom edge.
- Local campaign/team/area/task data is written to a primary snapshot plus local backup and can recover from one invalid copy.
- CI passes TypeScript typecheck and production build before merge.

## Constraints

- Keep website-only architecture.
- Keep CARTO Voyager Retina as the basemap unless it itself fails.
- Do not add a service worker, PWA manifest, route history or GPS persistence.
- Do not invent or bind a D1 database id in this stability pass.

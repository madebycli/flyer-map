---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M2 functionality exists, but production-phone verification still exposes a blocking map-overlay rendering problem. Plan 005 is the current release gate before any further feature work.

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

The latest real-device test still reported:
- the CARTO basemap rendered normally;
- no application geometry was visible;
- saved area fills/outlines were absent;
- selected-area highlighting was absent;
- live area draw points/lines were absent;
- Street Mode draft and saved street lines were absent.

Because every application geometry type failed together, this is treated as an overlay bootstrap failure rather than a color/contrast issue.

## Current stability direction

Plan 004 already removed the stale loading badge, reduced field UI chrome, changed geolocation to one-shot centering and hardened local snapshot storage.

Plan 005 now removes the remaining overlay lifecycle gate:
- application GeoJSON sources are embedded directly in the initial MapLibre style passed to `new Map(...)`;
- areas, street tasks and draft/edit geometry use three application sources total;
- saved areas/tasks are seeded into the initial style data instead of waiting for a later event;
- React state updates write directly to those three sources without a `ready` boolean;
- MapLibre `styledata`/`load` events are used only as resync fallbacks, not as prerequisites for source/layer creation;
- a slow/incomplete raster tile load can no longer be the reason application sources do not exist.

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

The Plan 005 implementation head has passed dependency installation, TypeScript typecheck and the production Vite/Cloudflare build before the final docs-only update.

Real-device acceptance remains open until the production phone visibly shows area draft geometry, saved areas, selection highlighting, street draft geometry and saved street tasks.

## Active plans

- `docs/plans/active/002-m1-campaign-team-areas.md` — real-device acceptance blocked by current overlay verification
- `docs/plans/active/003-m2-street-mode.md` — real-device acceptance blocked by current overlay verification
- `docs/plans/active/004-mobile-map-stability.md` — UI/geolocation/persistence stability pass
- `docs/plans/active/005-overlay-style-bootstrap.md` — current blocker/release gate

## Not connected yet

- production D1 database/binding
- shared campaign state across devices
- authorization/access links
- resilient durable mutation queue
- OSM street import/snap-to-road
- House Mode

## Next

1. Merge Plan 005 only after the final CI gate is green.
2. Deploy through the normal `main` Cloudflare build.
3. On the phone verify: live area drawing, saved area visibility, selected-area halo, live street drawing and saved street visibility.
4. Reload and verify teams/areas/tasks persist.
5. If geometry still fails, use the next pass for explicit on-screen renderer diagnostics rather than adding more product features.
6. Only after those checks close the stability plans and proceed to shared Worker/D1 persistence.

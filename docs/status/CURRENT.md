---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M2 — Street Mode task interaction implemented; production-phone verification remains open.

## Working

The mobile map workflow includes:
- editable campaign and named/color-coded teams
- editable team areas with persistent local snapshot
- high-contrast selected-area rendering
- local-only browser geolocation
- MapLibre with CARTO Voyager Retina basemap
- schema-v2 campaign snapshot with migration from existing M1 local data
- manually traced street LineString tasks assigned to an area
- street-task persistence across reloads on the same device
- map rendering above area fills with team color plus white casing
- visually distinct task states: solid open, faded/thinner completed, dashed later, dotted not-deliverable
- tap-to-select street tasks with explicit status bottom sheet
- large labeled controls for `open`, `completed`, `later`, `not-deliverable`
- immediate status updates with a 6-second Undo action
- street rename/deletion and area-delete cascade for local tasks

Cloudflare Workers Builds is connected to `main` and the production/test deployment remains:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

## Current architecture direction

- normal mobile-first website only
- no native app, PWA, service worker or Web App Manifest
- GPS remains local-only; no route recording or location history
- MapLibre remains the renderer
- CARTO Voyager Retina remains the basemap
- areas and street tasks are application-controlled GeoJSON overlays
- browser snapshot persistence is single-device only, not synchronization
- campaign revision remains the coarse future Worker/D1 version primitive

## Verification

PR #9 fixed the reported selected-area visibility problem with a dedicated white halo plus stronger team-color outline and passed CI before merge.

The M2 implementation has passed GitHub Actions dependency installation, TypeScript type checking and the production Vite/Cloudflare build on its implementation head. The final PR head must repeat that green gate before merge. Real-device testing remains required for Street Mode touch interaction, status readability and Undo placement.

See `docs/architecture/MAP.md`, `docs/architecture/DATA.md`, `docs/product/UX.md`, Plan 002 and Plan 003.

## Not connected yet

- production D1 database/binding
- shared campaign state across devices
- authorization/access links
- resilient durable mutation queue
- OSM street import/snap-to-road
- House Mode

## Active plans

- `docs/plans/active/002-m1-campaign-team-areas.md` — waiting on final real-device M1 verification
- `docs/plans/active/003-m2-street-mode.md` — implementation complete; field verification pending

## Known issues

- Selected-area highlight fix still needs confirmation on the production phone after Cloudflare deployment.
- Street Mode has not yet been field-tested on the production phone.
- localStorage persistence is deliberately single-device; edits do not synchronize between phones yet.

## Next

1. On the phone, confirm the selected-area halo is now obvious.
2. Select an area, trace a street, save it, tap it and test all four statuses plus immediate Undo.
3. Reload and verify areas, street lines and statuses persist.
4. Verify narrow width/safe areas on Android Chrome and iPhone Safari.
5. If the field interaction is usable, close Plans 002/003 and move to shared Worker/D1 persistence.

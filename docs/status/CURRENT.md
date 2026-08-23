---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M1 — Campaign, teams and editable assigned areas implemented; real-device interaction verification remains open.

## Working

`main` contains and CI validates the mobile website foundation:
- React/Vite mobile website shell
- Cloudflare Worker health endpoint
- MapLibre with CARTO Voyager Retina raster basemap
- browser geolocation control with local-only GPS use
- GitHub CI and Cloudflare deployment pipeline

The current M1 slice adds:
- one editable campaign/Verteilaktion
- named teams with unique selectable colors
- compact mobile team management
- map-first polygon drawing with explicit Save/Cancel/Undo
- assignment of every area to a team
- simultaneous colored area fills/outlines
- tap-to-select area management
- explicit high-contrast selected-area halo so the chosen polygon remains visible over the basemap
- area rename and team reassignment
- mobile-friendly polygon editing with large vertex handles
- invalid/self-intersecting polygon rejection
- area deletion with explicit confirmation
- versioned browser campaign snapshot persisted across reloads on the same device
- a domain/storage boundary designed to move behind Worker/D1 later

Cloudflare Workers Builds is connected to `main` and the deployment is available at:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

## Current architecture direction

- normal mobile-first website only
- no native app
- no installable PWA
- no service worker/manifest lifecycle
- browser geolocation remains local-only in MVP
- MapLibre remains the renderer
- CARTO Voyager Retina raster tiles remain the current MVP basemap
- campaign/team/area geometry is application-controlled GeoJSON above the basemap
- M1 persistence is localStorage on one device, not shared synchronization
- campaign snapshots carry a revision field so later Worker/D1 polling/version checks do not require a client-state redesign

## Verification

GitHub Actions has passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build for the M1 implementation branch.

M0 production-phone tests were sufficient to close the foundation milestone and begin product work. Real-device feedback on M1 found that selected polygons were not visually obvious because the original selection treatment only reused the team color with slightly greater opacity/line width. The current M1 fix introduces a dedicated white selection halo plus a stronger team-color outline and needs production-phone verification after deployment.

See `docs/operations/PRODUCTION.md`, `docs/architecture/MAP.md`, `docs/architecture/DATA.md` and Plan 002.

## Not connected yet

- production D1 database/binding
- shared campaign state across devices
- authorization/access links
- resilient mutation queue
- street/task completion workflow

## Active plan

`docs/plans/active/002-m1-campaign-team-areas.md`

## Known issues

- The complete M1 interaction still needs field verification after the selected-area highlight fix is deployed.
- localStorage persistence is deliberately single-device; edits do not yet synchronize between phones.
- Basemap performance/readability should continue to be observed on mobile data, but minor map cosmetics no longer block product milestones.

## Next

1. Verify selected-area visibility plus team management, drawing, editing, deletion and reload persistence on the real phone.
2. Verify narrow width, safe areas, Android/Chrome and iPhone/Safari behavior.
3. Close/archive Plan 002 after the real-device M1 flow is field-usable.
4. Start Street Mode task interaction: street-level tasks with `open`, `completed`, `later`, `not-deliverable` and undo.
5. Connect shared Worker/D1 persistence before multi-device campaign use is considered ready.

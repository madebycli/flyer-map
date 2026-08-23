---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M0 — Production website deployed; mobile map performance verification in progress.

## Working

`main` contains and CI has validated:
- React/Vite mobile website shell
- Cloudflare Worker health endpoint
- MapLibre map
- browser geolocation control
- initial D1 schema proposal
- agent context/documentation system
- GitHub CI and contribution templates

Cloudflare Workers Builds is connected to `main` and the deployment is available at:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

## Current architecture direction

- website only
- no native app
- no installable PWA
- no service worker/manifest lifecycle
- browser geolocation remains supported
- MapLibre remains the renderer
- CARTO Positron Retina raster tiles are the current MVP basemap for mobile performance
- distribution areas/tasks remain application-controlled vector overlays

## Verification

The foundation build passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

Real-device testing confirmed that the website and browser map interactions work, but public vector basemap attempts were operationally unreliable or too slow on the test phone. The CARTO vector style eventually rendered, but first useful map display could take roughly 10–20 seconds and moving the map exposed slow-loading blank regions.

The current performance change replaces the vector basemap with CARTO 2x Retina raster tiles over four CDN hosts, removes the vector-to-raster fallback chain, starts MapLibre through the normal module graph and retains pending lower-zoom tiles while zooming for smoother continuity.

See `docs/operations/PRODUCTION.md` and ADR-0008.

## Not connected yet

- D1 database/binding
- shared campaign state
- resilient mutation queue

## Active plan

`docs/plans/active/001-foundation.md`

## Known issues

The optimized Retina raster map still needs real-phone verification after deployment. Basemap performance on mobile data is a release-quality concern and should be judged by perceived first useful render and pan/zoom continuity, not only by build success.

## Next

1. Verify first useful map render and pan/zoom continuity on the real phone.
2. Verify browser geolocation.
3. Complete and archive Plan 001 if the map is field-usable.
4. Start M1: campaign/team/area data model and editable map layers.

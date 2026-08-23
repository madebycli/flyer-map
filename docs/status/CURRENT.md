---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M0 — Production website deployed; mobile map performance/visual verification in progress.

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
- CARTO Voyager Retina raster tiles are the current MVP basemap for mobile performance plus a more familiar colorful street-map appearance
- distribution areas/tasks remain application-controlled vector overlays

## Verification

The foundation build passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

Real-device testing confirmed that the website and browser map interactions work, but public vector basemap attempts were operationally unreliable or too slow on the test phone. The CARTO vector style eventually rendered, but first useful map display could take roughly 10–20 seconds and moving the map exposed slow-loading blank regions.

The performance change moved to CARTO 2x Retina raster tiles over four CDN hosts, removed the vector-to-raster fallback chain, starts MapLibre through the normal module graph and retains pending lower-zoom tiles while zooming for smoother continuity.

Real-device visual review then rejected the very pale Positron styling. The current change keeps the same Retina/CDN performance strategy but switches the tile style to CARTO Voyager so roads, parks, water and general map context have more color and contrast.

See `docs/operations/PRODUCTION.md`, `docs/architecture/MAP.md` and ADR-0008.

## Not connected yet

- D1 database/binding
- shared campaign state
- resilient mutation queue

## Active plan

`docs/plans/active/001-foundation.md`

## Known issues

The Voyager Retina map still needs real-phone verification after deployment. Basemap performance and readability on mobile data remain release-quality concerns and should be judged by perceived first useful render, pan/zoom continuity and field readability.

## Next

1. Verify Voyager color/readability and first useful map render on the real phone.
2. Verify pan/zoom continuity and browser geolocation.
3. Complete and archive Plan 001 if the map is field-usable.
4. Start M1: campaign/team/area data model and editable map layers.

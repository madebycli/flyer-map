---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M0 — Production website deployed; mobile map verification in progress.

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
- crisp vector basemap is being switched to VersaTiles after the temporary OSM raster fallback looked soft on high-DPI phones

## Verification

The foundation build passed dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

Real-device testing confirmed that the production website loads. The initial OpenFreeMap vector source failed at street-level zoom, and the temporary standard OSM raster fallback restored detail but looked visibly soft on modern high-DPI phones. The current change switches back to vector rendering using VersaTiles.

See `docs/operations/PRODUCTION.md`.

## Not connected yet

- D1 database/binding
- shared campaign state
- resilient mutation queue

## Active plan

`docs/plans/active/001-foundation.md`

## Known issues

The new VersaTiles vector basemap still needs confirmation on the real phone after deployment.

## Next

1. Verify crisp street/building rendering with the VersaTiles vector basemap.
2. Verify browser geolocation.
3. Complete and archive Plan 001.
4. Start M1: campaign/team/area data model and editable map layers.

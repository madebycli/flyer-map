---
id: operations-production
type: operations
status: active
last_updated: 2026-08-24
related: [operations-deployment]
---

# Production

## Current deployment

Primary production/test endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

Health endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/api/health`

## Deployment source

- GitHub repository: `madebycli/flyer-map`
- production branch: `main`
- platform: Cloudflare Workers
- deploy flow: GitHub -> Cloudflare Workers Builds -> `workers.dev`

## Current verification state

Cloudflare is connected to `main` and automatically builds/deploys merged changes.

Real-phone testing during M0 confirmed that the website loads, MapLibre interaction works and browser geolocation remains available. Several public basemap strategies were rejected after production-phone testing; the current map uses CARTO Voyager Retina raster tiles through four CDN hosts for a sharper, more colorful and more predictable mobile background.

Minor first-render/pan continuity and readability observations remain ongoing field-quality checks, but they no longer block M1 product work.

## Current field verification checklist

On a supported phone:

1. open the production URL;
2. confirm the application shell and current campaign UI render;
3. confirm the CARTO Voyager/MapLibre map renders;
4. pan and zoom the map;
5. use the geolocation control and verify map use also remains possible if permission is denied;
6. create/rename a team and choose its color;
7. draw, save, select, edit and delete a test area;
8. reload and confirm campaign/team/area data persists on the same phone;
9. verify no horizontal overflow or controls hidden behind browser safe areas;
10. open `/api/health` and confirm an HTTP success response with `ok: true`.

The site is a normal website: there is no PWA installation, Web App Manifest or service worker verification step.

Record device/browser-specific problems as GitHub issues.

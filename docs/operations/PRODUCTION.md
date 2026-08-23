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

Cloudflare accepted the deployment after the Worker compatibility date was corrected to a non-future value.

External automated verification from the ChatGPT web environment was temporarily unable to resolve the newly created `workers.dev` hostname. Therefore the endpoint must still be verified from a real phone before M0 is considered complete.

## Required field verification

On a real supported phone:

1. open the production URL;
2. confirm the application shell renders;
3. confirm the OpenFreeMap/MapLibre map renders;
4. pan and zoom the map;
5. use the geolocation control;
6. allow location access and confirm a current-location marker appears;
7. reload the application;
8. open `/api/health` and confirm an HTTP success response with `ok: true`;
9. optionally add the PWA to the home screen and reopen it.

Record device/browser-specific problems as GitHub issues.

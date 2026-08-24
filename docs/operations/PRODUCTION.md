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

## M4 production preparation

On 2026-08-24 the production prerequisites for M4 were prepared before merging PR #16:

- Worker secret `M4_BOOTSTRAP_SECRET` was configured outside the repository;
- remote D1 database `flyer-map-db` was inspected through Wrangler;
- `0002_m4_access.sql` was the only pending migration;
- `npx wrangler d1 migrations apply flyer-map-db --remote` executed 14 commands successfully;
- Wrangler reported `0002_m4_access.sql` with status ✅.

`0001_initial.sql` remains immutable production history. M4 therefore has the database columns/tables required for shared Campaign map focus, access grants and revocable sessions before its Worker code is deployed.

## Current verification state

Cloudflare is connected to `main` and automatically builds/deploys merged changes.

Real-phone testing during earlier milestones confirmed that the website loads, MapLibre interaction works and browser geolocation remains available. Several public basemap strategies were rejected after production-phone testing; the current map uses CARTO Voyager Retina raster tiles through four CDN hosts for a sharper, more colorful and more predictable mobile background.

M4 branch CI #91 passed tests, TypeScript and production build. The next production verification is performed after PR #16 merges and Cloudflare deploys Worker version 0.3.0.

## M4 post-deploy verification checklist

1. Open `/api/health` and confirm `ok: true`, `version: "0.3.0"`, `persistence: "d1"`, `authorization: "access-links"`.
2. Confirm a protected Campaign endpoint without a valid session returns HTTP 401 rather than exposing data from only the Campaign id.
3. Explicitly bootstrap each known pre-M4 Campaign that still needs its initial Admin grant; never use a first-visitor claim flow.
4. Confirm Admin, scoped Team Editor and Viewer behavior matches the M4 permission matrix.
5. Revoke a test grant and confirm an already-issued session loses access.
6. Confirm remote refresh updates in memory without page reload or camera reset.
7. Confirm an active area/street draw or area edit is not silently overwritten by a remote snapshot.
8. On a supported phone, pan/zoom/rotate and use the compass/geolocation controls.
9. Confirm stored Area corner/edit points are not visible in browse mode; edit points appear only while the Area is actively being edited.
10. Confirm Campaign focus fallback and browser-local personal camera state behave independently.
11. Confirm German/English application UI can be switched without changing provider-rendered raster labels.

## Renderer performance follow-up

A separate post-M4 branch, `renderer-webgl-performance`, is reserved for whole-city rendering work. It must not change M4 deployment semantics. The intended direction is to move saved Areas/Streets into MapLibre WebGL layers while retaining SVG only for active draw/edit previews and edit handles. This is specifically to remove overlay lag on mobile and provide headroom for hundreds or thousands of saved street features.

The site remains a normal website: there is no PWA installation, Web App Manifest or service worker verification step.

Record device/browser-specific problems as GitHub issues.
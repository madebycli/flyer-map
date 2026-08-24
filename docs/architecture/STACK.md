---
id: architecture-stack
type: architecture
status: accepted
last_updated: 2026-08-24
---

# Stack

## Client

- TypeScript
- React
- Vite
- plain CSS
- MapLibre GL JS
- browser SVG for Verteil-Flyer application geometry

React owns the field UI and campaign snapshot state. It is not permission to add a heavy component framework.

The product is a normal mobile-first website. It does not use a Web App Manifest or service worker for installation.

M3 keeps browser `localStorage` as the startup/last-known snapshot cache and fallback while the Worker + D1 become the shared source of truth.

## Cloudflare

- Cloudflare Workers
- Workers Static Assets
- Cloudflare Vite plugin
- Cloudflare D1 for shared campaign persistence

The frontend and API deploy as one Worker unit.

## Map

- MapLibre GL JS for CARTO Voyager Retina raster basemap rendering, navigation and local one-shot geolocation
- independent SVG overlay for areas, streets, selected geometry, draw/edit previews and vertex markers
- four CARTO CDN hosts for tile delivery
- OpenStreetMap-derived basemap data

The production-phone stability gate forbids reintroducing MapLibre application GeoJSON layers. Application selection uses the existing application-side point-in-polygon and screen-distance hit testing.

The basemap provider configuration must stay isolated so it can be replaced without rewriting application logic.

## Persistence

M3 uses:
- the existing schema-v2 campaign snapshot in the browser;
- `GET/PUT` Worker snapshot endpoints;
- a lightweight Worker version endpoint for polling;
- normalized D1 tables for campaigns, teams, areas and street tasks;
- one shared campaign revision for optimistic concurrency.

A durable offline mutation queue remains M5 scope.

## Dependency policy

A dependency should be added only when it provides meaningful value that would be costly or risky to implement locally.

Avoid adding:
- component suites
- animation frameworks
- large utility libraries for one function
- analytics SDKs in MVP
- external font packages

M3 introduces no synchronization library: normal Fetch, localStorage and the D1 Worker API are sufficient for this milestone.

## Version policy

Dependencies are pinned in `package.json`. Upgrade intentionally through review rather than silently drifting major versions.

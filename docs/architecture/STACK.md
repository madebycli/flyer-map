---
id: architecture-stack
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture, architecture-map]
source_of_truth_for: [runtime-stack, dependency-policy]
---

# Stack

## Client

- TypeScript
- React 19
- Vite
- plain CSS
- MapLibre GL JS **5.7.1 pinned**

React owns the website UI and current in-memory Campaign state. Do not introduce a heavy component framework without a concrete need.

The product is a normal mobile-first website. No native app, service worker, installable PWA or Web App Manifest installation flow is part of the accepted baseline.

## Cloudflare

- Cloudflare Workers
- Workers Static Assets
- Cloudflare Vite plugin
- Cloudflare D1

Frontend assets and API deploy as one Worker unit.

## Map

- CARTO Voyager Retina raster basemap using OpenStreetMap-derived data
- MapLibre for basemap, camera, rotation/compass, one-shot geolocation, saved Areas and saved Street Tasks
- two long-lived application GeoJSON sources for saved geometry
- a small constant set of MapLibre Fill/Line layers
- independent SVG overlay only for active Area draw/edit and Street draw geometry/handles

Normal browse pan/zoom/rotate must not execute an application projection/repaint loop over every saved Area/Street.

### MapLibre version pin

`maplibre-gl` is currently pinned to `5.7.1` in `package.json`.

The tested `6.4.1` runtime produced a real-browser GeoJSON rendering regression in this project: basemap/FPS were healthy while saved application GeoJSON became invisible/non-interactive. Therefore map runtime upgrades require explicit browser acceptance with saved Area + Street visibility and hit testing, not just green TypeScript/CI.

## Persistence and sync

Current shared persistence:
- Cloudflare D1 as server source of truth;
- localStorage last-known snapshot/cache;
- protected Worker snapshot/version API;
- coarse Campaign revision for optimistic concurrency;
- secure Campaign-scoped access/session authorization.

M5 is planned to add an IndexedDB-backed durable mutation queue and idempotent narrower writes. No service worker or Background Sync API.

## Future data/tooling

Planned Smart Street/House work may add a reviewed OSM/OSM-derived geometry data dependency. Do not select a provider or add a large geospatial dependency before the M6 research/design slice documents licensing, caching and performance constraints.

Planned statistics/admin features should prefer server/domain data and small focused UI dependencies. Avoid adding analytics SDKs or dashboard frameworks merely to render a few charts/tables.

## Dependency policy

Add a dependency only when it solves a demonstrated problem more safely/cheaply than local code.

Avoid:
- heavy component suites;
- animation frameworks without UX value;
- large utility libraries for one function;
- unnecessary telemetry/analytics SDKs;
- external font packages;
- per-feature map libraries when MapLibre already provides the primitive.

## Version policy

Dependencies are intentionally pinned in `package.json`. Upgrade through review and real acceptance where runtime behavior matters; do not silently drift major versions.

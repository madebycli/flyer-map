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

React is used for maintainable UI state and broad tool/agent familiarity. It is not permission to add a heavy component framework.

The product is a normal mobile-first website. It does not use a Web App Manifest or service worker for installation.

## Cloudflare

- Cloudflare Workers
- Workers Static Assets
- Cloudflare Vite plugin
- D1 when shared persistence is introduced

The frontend and API deploy as one Worker unit.

## Map

- MapLibre GL JS for rendering/interactions and application overlays
- CARTO Positron Retina raster tiles as the current performance-oriented basemap
- four CARTO CDN hosts for tile delivery
- OpenStreetMap-derived basemap data

The raster choice is limited to the background map. Team areas, tasks, completion state and other Verteil-Flyer geometry remain application-controlled vector/GeoJSON layers.

The provider configuration must stay isolated so the basemap can be replaced without rewriting application logic.

## Dependency policy

A dependency should be added only when it provides meaningful value that would be costly or risky to implement locally.

Avoid adding:
- component suites
- animation frameworks
- large utility libraries for one function
- analytics SDKs in MVP
- external font packages

## Version policy

Dependencies are pinned in `package.json` during the foundation stage. Upgrade intentionally through review rather than silently drifting major versions.

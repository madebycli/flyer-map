# Plan 001 — Repository Foundation

## Goal

Establish a deployable, agent-friendly and lightweight mobile website base before domain features are implemented.

## Relevant context

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/product/MVP.md`
- `docs/architecture/STACK.md`
- `docs/architecture/MAP.md`
- `docs/quality/QUALITY.md`
- `docs/operations/DEPLOYMENT.md`
- `docs/operations/PRODUCTION.md`

## Tasks

- [x] initialize repository
- [x] add agent context system
- [x] add ADR structure
- [x] scaffold TypeScript/React/Vite website
- [x] add Cloudflare Worker configuration
- [x] add health API endpoint
- [x] add MapLibre map prototype
- [x] add browser geolocation control
- [x] remove PWA manifest/service-worker lifecycle after website-only decision
- [x] add initial database schema proposal
- [x] add GitHub CI and contribution templates
- [x] verify dependency install/typecheck/build in CI
- [x] merge foundation PR
- [x] connect merged `main` to Cloudflare
- [x] obtain first production `workers.dev` deployment
- [x] verify map interaction and browser geolocation basis on a real phone
- [x] settle on the current CARTO Voyager Retina raster basemap after real-device provider/performance tests

## Acceptance criteria

- CI installs dependencies and `npm run check` passes.
- Website renders a full-screen map in a supported mobile browser.
- Street/building rendering is usable and sufficiently crisp on the tested high-DPI phone.
- Geolocation denial does not break map use.
- `/api/health` works after Cloudflare deployment.
- A new ChatGPT coding session can orient itself from the three context entrypoints without reading all docs.

## Verification

The foundation passed GitHub Actions CI, including dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

Production/test endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

Real-device testing confirmed that the website loads and normal map interaction works. Several public basemap approaches were tested and rejected for production-phone behavior. The current MVP background is CARTO Voyager Retina raster tiles through four CDN hosts, while MapLibre remains the renderer and future distribution geometry stays application-controlled vector/GeoJSON overlays.

Minor future basemap performance/readability observations remain quality work, not blockers for beginning domain functionality.

## Risks carried forward

- external basemap availability is not controlled by this project
- map performance still needs continued observation on mobile data and on iPhone/Safari

## Decisions made

- website-only over native app or installable PWA
- Cloudflare Workers Static Assets over a separate Pages frontend
- MapLibre with a replaceable OpenStreetMap-derived basemap
- CARTO Voyager Retina raster for the current MVP basemap
- Context Graph Lite over a full GraphRAG infrastructure

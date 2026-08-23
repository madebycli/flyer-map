# Plan 001 — Repository Foundation

## Goal

Establish a deployable, agent-friendly and lightweight mobile website base before domain features are implemented.

## Relevant context

- `AGENTS.md`
- `ARCHITECTURE.md`
- `docs/product/MVP.md`
- `docs/architecture/STACK.md`
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
- [ ] verify crisp vector map + geolocation on a real phone

## Acceptance criteria

- CI installs dependencies and `npm run check` passes.
- Website renders a full-screen map in a supported mobile browser.
- Street/building rendering is crisp enough on a high-DPI phone.
- Geolocation denial does not break map use.
- `/api/health` works after Cloudflare deployment.
- A new ChatGPT coding session can orient itself from the three context entrypoints without reading all docs.

## Verification

The foundation passed GitHub Actions CI, including dependency installation, TypeScript type checking and the production Vite/Cloudflare build.

The first Cloudflare deployment initially failed because `compatibility_date` was one UTC day in the future. PR #2 corrected the value to `2026-08-01`.

Production/test endpoint:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

Real-device testing confirmed that the website loads. Basemap testing exposed two provider/display issues: OpenFreeMap lost street-level detail from the production origin, and the temporary OSM raster fallback looked soft on a high-DPI phone. The current vector fallback uses VersaTiles and still requires device verification.

## Risks

- external basemap availability is not controlled by this project
- mobile browser/geolocation behavior still requires field verification

## Decisions made

- website-only over native app or installable PWA
- Cloudflare Workers Static Assets over a separate Pages frontend
- MapLibre with a replaceable OpenStreetMap-derived vector basemap
- Context Graph Lite over a full GraphRAG infrastructure

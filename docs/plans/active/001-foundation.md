# Plan 001 — Repository Foundation

## Goal

Establish a deployable, agent-friendly and lightweight project base before domain features are implemented.

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
- [x] scaffold TypeScript/React/Vite app
- [x] add Cloudflare Worker configuration
- [x] add health API endpoint
- [x] add MapLibre/OpenFreeMap prototype
- [x] add browser geolocation control
- [x] add PWA manifest/service-worker lifecycle
- [x] add initial database schema proposal
- [x] add GitHub CI and contribution templates
- [x] verify dependency install/typecheck/build in CI
- [x] merge foundation PR
- [x] connect merged `main` to Cloudflare
- [x] obtain first production `workers.dev` deployment
- [ ] verify first production deployment on a real phone

## Acceptance criteria

- CI installs dependencies and `npm run check` passes.
- App renders a full-screen map on a supported mobile browser.
- Geolocation denial does not break map use.
- `/api/health` works after Cloudflare deployment.
- A new ChatGPT coding session can orient itself from the three context entrypoints without reading all docs.

## Verification

The final foundation pull-request head passed GitHub Actions CI, including dependency installation, TypeScript type checking and the production Vite/Cloudflare build. PR #1 was squash-merged into `main`.

The first Cloudflare deployment initially failed because `compatibility_date` was one UTC day in the future. PR #2 corrected the value to `2026-08-01` and was merged after green CI.

Production/test endpoint reported by Cloudflare:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

The remaining M0 gate is real-device verification of the app shell, map, geolocation and `/api/health`.

## Risks

- PWA install behavior differs slightly between browsers
- external basemap availability is not controlled by this project
- mobile browser/geolocation behavior still requires field verification

## Decisions made

- PWA over native app for MVP
- Cloudflare Workers Static Assets over a separate Pages frontend
- MapLibre/OpenFreeMap over Google Maps for initial map stack
- Context Graph Lite over a full GraphRAG infrastructure

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
- [ ] merge foundation PR
- [ ] connect merged `main` to Cloudflare
- [ ] verify first production deployment on real phones

## Acceptance criteria

- CI installs dependencies and `npm run check` passes.
- App renders a full-screen map on a supported mobile browser.
- Geolocation denial does not break map use.
- `/api/health` works after Cloudflare deployment.
- A new ChatGPT coding session can orient itself from the three context entrypoints without reading all docs.

## Verification

GitHub Actions CI run #2 passed on 2026-08-24 after validating dependency installation, TypeScript and the production Vite/Cloudflare build.

## Risks

- first Cloudflare configuration may require a dashboard-specific adjustment
- PWA install behavior differs slightly between browsers
- external basemap availability is not controlled by this project

## Decisions made

- PWA over native app for MVP
- Cloudflare Workers Static Assets over a separate Pages frontend
- MapLibre/OpenFreeMap over Google Maps for initial map stack
- Context Graph Lite over a full GraphRAG infrastructure

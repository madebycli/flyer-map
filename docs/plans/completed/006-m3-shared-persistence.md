# Plan 006 — M3 Shared Persistence

## Status

Completed on 2026-08-24 through PR #14.

## Goal

Move the existing campaign snapshot from single-browser persistence to shared Cloudflare Worker + D1 persistence while preserving the current localStorage cache/fallback and the production-proven SVG map renderer.

## Completed scope

- [x] Worker API for campaign snapshot GET/PUT and revision GET
- [x] server-side validation for campaign membership, statuses and geometry
- [x] optimistic concurrency with shared revision and visible HTTP 409 conflict handling
- [x] atomic full-snapshot D1 replacement guarded by an internal write token
- [x] constant seven-statement D1 write using JSON bulk INSERTs
- [x] teams, team colors, areas, Polygon geometry, street tasks, LineString geometry, all four statuses and `completedAt` persisted in D1
- [x] localStorage retained as startup cache, last-known snapshot and fallback
- [x] safe first-time bootstrap of existing local campaign data into D1
- [x] `?campaign=` selector for opening the same M3 campaign in another browser/device
- [x] approximately five-second revision polling plus online/visibility refresh
- [x] conflicting/rejected optimistic local snapshots preserved separately before server reload
- [x] focused validation and concurrency tests
- [x] real production D1 database bound as `DB`
- [x] production migration `0001_initial.sql` applied and confirmed in `d1_migrations`
- [x] final PR-head CI #68 passed all tests, TypeScript and production build
- [x] PR #14 merged to `main` as `ad7c921c36c2b411dd26ec87cd2177766fac968e`

## Release gate preserved

No `src/map/*` renderer file changed in M3.

MapLibre remains responsible only for CARTO Voyager Retina, navigation and one-shot local geolocation. Areas, streets, drafts, edit geometry and selected-area corner markers remain in the independent SVG overlay. No MapLibre application GeoJSON layers were reintroduced.

## API

- `GET /api/campaigns/:campaignId/snapshot`
- `PUT /api/campaigns/:campaignId/snapshot`
- `GET /api/campaigns/:campaignId/version`

## D1 model

Normalized tables:
- `campaigns`
- `teams`
- `areas`
- `tasks`

`campaigns.revision` is the shared optimistic-concurrency version. `campaigns.write_token` is an internal per-write guard and is not application data.

## Verification

- validation tests cover valid snapshots, invalid/self-intersecting polygons, cross-campaign ownership, `completedAt` consistency and route/payload campaign mismatch;
- repository tests cover successful revision claims, stale claims and constant-size D1 snapshot replacement;
- CI #62 passed before D1 binding;
- CI #66 passed with the real D1 binding;
- CI #68 passed after production migration confirmation and was the final merge gate.

## Deferred

M3 intentionally does not include:
- login/user accounts
- invite/access links
- roles/permissions
- WebSockets
- durable multi-mutation offline queue
- OSM street import
- House Mode
- GPS routes/history
- PWA/service worker

## Next logical milestone

M4 — access links and authorization so a campaign URL is no longer merely an identifier and shared writes are protected by campaign-scoped permissions.

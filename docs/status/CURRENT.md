---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M3 — Shared Persistence is technically complete and merged to `main` through PR #14 (`ad7c921c36c2b411dd26ec87cd2177766fac968e`).

The next logical milestone is M4 — access links and authorization.

The production-phone stability gate from PR #13 remains accepted: areas, streets, draft geometry and selected-area corner markers are visible on the real phone. The renderer release gate remains unchanged.

## Working in code

The mobile field workflow includes:
- editable named/color-coded teams
- editable polygon areas
- manually traced street LineString tasks
- statuses `open`, `completed`, `later`, `not-deliverable`
- `completedAt` and immediate status Undo
- CARTO Voyager Retina basemap
- local-only one-shot geolocation
- independent SVG overlay for all Verteil-Flyer application geometry
- primary + backup localStorage snapshots

M3 adds shared persistence through:
- `GET /api/campaigns/:campaignId/snapshot`
- `PUT /api/campaigns/:campaignId/snapshot`
- `GET /api/campaigns/:campaignId/version`
- server-side snapshot, membership, status and geometry validation
- normalized D1 campaign/team/area/task persistence
- shared revision with HTTP 409 conflict handling
- transactional D1 replacement guarded by an internal per-write token
- constant-size JSON bulk INSERT statements
- localStorage-first startup and safe bootstrap of existing local campaigns
- `?campaign=` shared campaign selection for M3 multi-browser testing
- five-second revision polling while online/visible
- local conflict backup plus visible user notification before reloading current server state

The working SVG/MapLibre renderer was not changed by M3.

## D1

Production D1 database: `flyer-map-db`.

Worker binding: `DB`.

Migration `0001_initial.sql` is confirmed in `d1_migrations` and provides:
- `campaigns`
- `teams`
- `areas`
- `tasks`

`campaigns.revision` is the shared optimistic-concurrency version. `campaigns.write_token` is an internal write guard.

## Verification

- CI #62 passed all 7 tests, TypeScript and production build before the D1 binding commit.
- CI #66 passed all 7 tests, TypeScript and production build with the real D1 binding committed.
- final PR-head CI #68 passed all 7 tests, TypeScript and production build after production migration confirmation.
- PR #14 merged successfully to `main`.
- the M3 branch diff contained no `src/map/*` renderer changes.

## Production verification still required on real devices

After the automatic Cloudflare deployment from `main`:
1. verify `/api/health` reports the D1-backed service;
2. open one campaign on phone A and allow the existing local snapshot to bootstrap;
3. open the same `?campaign=` URL on phone B;
4. confirm teams, areas, streets, statuses and geometry match;
5. make a change on phone A and confirm phone B receives it after revision polling;
6. reload both phones and confirm D1 restores the same server state;
7. make near-simultaneous edits to confirm a stale write produces a visible conflict instead of silent overwrite;
8. confirm CARTO Voyager Retina and all independent SVG geometry render exactly as before M3.

## Completed plan

- `docs/plans/completed/006-m3-shared-persistence.md`

## Deferred beyond M3

- login/user accounts
- invite/access links and roles (M4)
- durable multi-mutation offline queue (M5)
- WebSockets
- OSM street import/snap-to-road
- House Mode
- GPS routes/history
- PWA/service worker

## Next

M4 should introduce revocable campaign-scoped access links and authorization for read/write operations without changing the map renderer or reintroducing native/PWA behavior.

---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M3 — Shared Persistence is active on feature branch `feat/m3-shared-persistence`.

The production-phone stability gate from PR #13 is accepted: areas, streets, draft geometry and selected-area corner markers are visible on the real phone. M1, M2 and the SVG stability plan are archived; broader Android/iPhone release hardening remains later work.

## Working in code

The existing mobile field workflow remains intact:
- editable named/color-coded teams
- editable polygon areas
- manually traced street LineString tasks
- statuses `open`, `completed`, `later`, `not-deliverable`
- `completedAt` and immediate status Undo
- CARTO Voyager Retina basemap
- local-only one-shot geolocation
- independent SVG overlay for all Verteil-Flyer application geometry
- primary + backup localStorage snapshots

M3 branch additionally implements:
- `GET /api/campaigns/:campaignId/snapshot`
- `PUT /api/campaigns/:campaignId/snapshot`
- `GET /api/campaigns/:campaignId/version`
- server-side snapshot, membership, status and geometry validation
- normalized D1 campaign/team/area/task persistence
- shared revision with HTTP 409 conflict handling
- transactional D1 replacement guarded by an internal per-write token
- constant-size JSON bulk INSERT statements to stay within D1 Free worker-query limits
- localStorage-first startup and safe bootstrap of existing local campaigns
- `?campaign=` shared campaign selection for M3 multi-browser testing
- five-second revision polling while online/visible
- local conflict backup plus visible user notification before reloading current server state

The working SVG/MapLibre renderer files are not part of the M3 persistence redesign.

## Deployment

Cloudflare Workers Builds remains connected to `main` and the current production deployment is:

`https://flyer-map.cloudflare-eleven035.workers.dev/`

`wrangler.jsonc` still has no D1 binding because no real production D1 database id has been provided yet. No id has been invented.

## Current blockers

- GitHub CI must validate the M3 branch tests, TypeScript and production build.
- A real Cloudflare D1 database must then be created/bound and migration `0001_initial.sql` applied before merge/deploy of the D1-dependent Worker.

## Active plan

- `docs/plans/active/006-m3-shared-persistence.md`

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

1. Open the M3 pull request and run CI.
2. Fix any test/type/build failures.
3. Provision the real D1 database and add only its returned id to the reviewed binding.
4. Apply migration 0001 before merge.
5. Require final green CI, then merge to `main` for automatic Cloudflare deploy.
6. Verify `/api/health` reports D1 and test one shared campaign on two phones.

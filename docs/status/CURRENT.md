---
id: status-current
type: status
status: active
last_updated: 2026-08-24
---

# Current Project State

## Milestone

M3 — Shared Persistence is active on feature branch `feat/m3-shared-persistence` and PR #14.

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

The real Cloudflare D1 database `flyer-map-db` has been created and its returned id is now reviewed in `wrangler.jsonc` under binding `DB`.

Migration `migrations/0001_initial.sql` has not yet been confirmed as applied to the remote D1 database. The D1-dependent Worker must not be merged/deployed before that schema exists.

## Verification

- PR #14 CI run #62 passed all 7 tests, TypeScript typecheck and production build before the D1 binding commit.
- A final CI run is required after the binding/config change and after migration confirmation.
- The branch diff still must not contain any `src/map/*` renderer changes.

## Current blocker

Apply migration `0001_initial.sql` to the production D1 database, then rerun final CI and merge only if green.

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

1. Apply migration `0001_initial.sql` to the bound production D1 database.
2. Run final CI on PR #14 and fix any failure.
3. Merge to `main` only when green.
4. Verify the automatic Cloudflare deployment and `/api/health`.
5. Test one shared campaign on two phones with revision polling and conflict visibility.

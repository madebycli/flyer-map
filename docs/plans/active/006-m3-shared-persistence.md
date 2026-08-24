# Plan 006 — M3 Shared Persistence

## Goal

Move the existing campaign snapshot from single-browser persistence to shared Cloudflare Worker + D1 persistence while preserving the current localStorage cache/fallback and the production-proven SVG map renderer.

## Relevant context

- `AGENTS.md`
- `docs/product/PRODUCT.md`
- `docs/product/MVP.md`
- `ARCHITECTURE.md`
- `docs/architecture/DATA.md`
- `docs/architecture/OFFLINE_SYNC.md`
- `docs/architecture/SECURITY.md`
- `docs/operations/DEPLOYMENT.md`
- ADR-0002, ADR-0006 and ADR-0008
- production-phone acceptance of the independent SVG application overlay from PR #13

## Release gate

Do not change the working map renderer boundary:
- MapLibre renders CARTO Voyager Retina, navigation and one-shot local geolocation only;
- areas, streets, draft geometry, edit geometry and selected-area corner markers remain in the independent SVG overlay;
- no MapLibre application GeoJSON layers may be reintroduced.

## Tasks

- [x] create a feature branch from the current `main`
- [x] close/archive the completed M1/M2/map-stability plans without claiming unperformed device coverage
- [x] update the initial D1 migration for the actual M3 snapshot model before first production application
- [x] add Worker snapshot/version endpoints
- [x] validate campaign/entity membership, statuses and geometry server-side
- [x] enforce optimistic concurrency without silent overwrite
- [x] keep localStorage as startup cache, last-known snapshot and fallback
- [x] safely bootstrap an existing local snapshot into D1 without deleting browser data
- [x] expose a campaign selector in the normal URL so the same M3 campaign can be opened on another browser before M4 access links exist
- [x] apply local mutations immediately and write the resulting snapshot to the Worker
- [x] poll campaign revision and load newer server state
- [x] preserve rejected/conflicting local snapshots separately in browser storage and surface a visible message
- [x] add focused validation/concurrency tests without changing the map renderer
- [x] update architecture/status/deployment documentation
- [ ] pass tests, TypeScript and production build in CI
- [ ] bind the real production D1 database id and apply migration 0001
- [ ] merge only after final green CI

## Acceptance criteria

- `GET /api/campaigns/:campaignId/snapshot` returns one validated campaign snapshot from D1.
- `PUT /api/campaigns/:campaignId/snapshot` creates or replaces one complete snapshot only when its optimistic-concurrency precondition is valid.
- `GET /api/campaigns/:campaignId/version` returns the current shared revision.
- Teams, colors, areas, polygon geometry, street tasks, street geometry, all four task statuses and `completedAt` round-trip through D1.
- Cross-campaign team/area/task references and invalid geometries are rejected by the Worker.
- A local mutation is visible immediately and is then synchronized.
- A stale write returns a visible conflict instead of silently overwriting another browser.
- On conflict/server rejection, the optimistic local snapshot is preserved separately in browser storage before the current server snapshot is loaded.
- Existing localStorage campaign data is uploaded on first M3 use when that campaign does not yet exist in D1.
- Opening the same campaign URL on two browsers loads the same server snapshot and polling detects later revisions.
- The independent SVG renderer remains unchanged.

## Verification so far

- server snapshot validation tests cover a valid full snapshot, invalid/self-intersecting polygon geometry, cross-campaign ownership, `completedAt` consistency and route/payload campaign mismatch;
- repository tests cover a successful revision claim, a stale/conflicting revision claim and constant seven-statement D1 snapshot replacement even with many street tasks;
- the bulk INSERT SQL path was additionally exercised against SQLite JSON functions/foreign keys during implementation review;
- current Cloudflare D1 documentation confirms `db.batch()` is transactional and the Workers Free plan has a 50-query-per-invocation limit, which is why M3 uses JSON bulk INSERTs instead of one query per entity;
- GitHub CI is the remaining code/build verification gate because the local execution container cannot resolve external GitHub/npm hosts.

## Risks

- Full-snapshot replacement must be atomic enough that a stale parallel request cannot partially replace child rows.
- M3 intentionally has no authorization yet; M4 must add access links/authorization before the shared API is considered secure for broader use.
- A durable multi-mutation offline queue remains M5; M3 only retains the latest local snapshot/fallback and retries ordinary transient failures while the page is open.

## Decisions made

- Keep schema version 2 and the existing domain shape; D1 is a persistence/source change, not a renderer/domain rewrite.
- Use campaign revision as the shared optimistic-concurrency primitive.
- Use one transactional D1 batch guarded by a server-generated internal write token so only the request that successfully claims the expected revision can replace child rows.
- Expand teams/areas/tasks from three JSON parameters inside SQLite using `json_each()` so snapshot writes use a constant seven D1 statements rather than one statement per entity.
- Keep the campaign id in a normal `?campaign=` URL parameter for M3 multi-browser selection. It is not an authorization token or M4 invite link.
- Preserve rejected optimistic snapshots in a dedicated localStorage conflict slot rather than silently discarding them.

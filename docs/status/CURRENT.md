---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 are merged on `main`.

M5 resilient mutation synchronization is complete and PR #24 is merged on `main`.

Accepted M5 behavior includes:
- durable IndexedDB-backed mutation queue;
- Worker-side idempotency and conflict preconditions;
- explicit blocked-auth / conflict / invalid / retry states;
- reconnect delivery without duplicate effect;
- saved Area/Street renderer behavior preserved;
- remote D1 mutation-ledger migration applied;
- strict cold fully-offline website startup remains outside the current no-Service-Worker architecture.

Verteil-Flyer remains a mobile-first normal website:
- no native app;
- no installable PWA;
- no Service Worker;
- no Background Sync API.

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina online basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers;
- active draw/edit geometry only in SVG;
- no application-side dense saved-geometry projection loop during browse.

Current Campaign roles remain Admin, Team Editor scoped to one Team, and Viewer. Worker authorization is authoritative.

## Active M5.5 prepared offline area

`docs/plans/active/011-offline-map-area.md` is the active implementation slice.

ADR-0012 is accepted with **Approach A**:
- bounded approximately 3 km raw OSM subset package;
- existing Worker owns fixed Overpass-compatible query templates and validation;
- upstream endpoint is server-configurable/replaceable;
- normalized versioned JSON/GeoJSON package preserves OSM identity/tags;
- browser IndexedDB stores the prepared package locally;
- local MapLibre sources/layers render prepared context while the already-loaded website is offline;
- no CARTO or OSM Foundation tile bulk cache;
- no R2/PMTiles pipeline for v1;
- same OSM identity/data direction should later feed M6 Smart Streets/Houses.

### Slice 1 Worker/package contract

Implemented on Draft PR #26 / branch `m55-offline-map-runtime`:
- shared `OfflineMapPackage v1` contract and validator;
- authenticated `POST /api/campaigns/:campaignId/offline-map/package` route;
- fixed server-owned Overpass query, 3 km server maximum and server-configurable upstream;
- bounded request/upstream/package sizes and timeout;
- normalized road/building geometry, OSM way identity and reviewed tag allowlist;
- explicit OSM attribution/license/source timestamps;
- hostile client query text is ignored rather than executed;
- code-like OSM tag values remain inert data.

CI #280 found a Node strip-types compatibility issue in the initial error class. The implementation was corrected and runtime commit `3f5f6383c88036a7e8ee32eda2a95f13bd846461` passed tests, strict TypeScript and production build in CI #281. Final docs-only head still needs its normal CI before merge.

Implementation order remaining:
1. merge Slice 1 after final head is green;
2. IndexedDB package lifecycle;
3. Settings download/update/delete UX;
4. MapLibre offline context;
5. dense real-mobile acceptance/performance.

## Full platform expansion

Primary umbrella plan:
- `docs/plans/active/012-platform-app-expansion.md`.

Planned sequence after M5.5:
1. M6 Smart Street + House geometry;
2. M6.5 Clothes Collection / Pickup mode;
3. M7 Field Sessions + Live Field Groups + comments/activity/automations;
4. M8 Organizations + username/password/TOTP admin accounts + configurable permissions + desktop Admin;
5. M9 statistics/progress + app-like navigation + Support/Feedback + appearance;
6. M10 security/field hardening/release.

## Security boundary for future accounts

Account/permissions work is not approved for ad-hoc implementation.

Before M8 account implementation, an accepted ADR/threat model must define password hashing, TOTP secret protection, account sessions/recovery, rate limiting, role/capability evaluation and legacy Campaign Admin migration.

Mandatory direction already recorded:
- parameterized/prepared D1 queries;
- no SQL concatenation with user input;
- raw passwords/TOTP secrets never logged;
- injected SQL/HTML/JS/code-like input remains inert data;
- authentication never replaces Worker-side authorization;
- Organization tenant isolation is non-bypassable;
- security/admin/permission changes are audited.

## Known follow-ups

Existing follow-ups remain visible:
- GitHub #22: desktop bottom-toolbar fit/spacing;
- GitHub #23: production health/recovery/diagnostics and dense Street validation.

## Immediate next

Finish/merge PR #26 with final green CI, then implement Plan 011 Slice 2 IndexedDB lifecycle. Do not introduce Service Worker/PWA behavior or cache CARTO/OSMF tiles. Keep M6 behavior outside the current slice until the prepared-area package path is stable.

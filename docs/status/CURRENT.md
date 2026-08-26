---
id: status-current
type: status
status: active
last_updated: 2026-08-26
---

# Current Project State

## Product baseline

Verteil-Flyer is a mobile-first normal website. The architecture still explicitly excludes:
- native app runtime;
- installable PWA behavior;
- Service Worker;
- Web App Manifest;
- Background Sync.

The field map remains MapLibre GL JS 5.7.1 with the CARTO online basemap. Prepared offline OSM context is stored separately in browser IndexedDB and does not bulk-cache CARTO/OSMF tiles.

M4 access/session authorization, M5 resilient mutation synchronization and the M5.5 prepared-offline-map storage lifecycle are established mainline foundations.

## Release integration candidate

The current platform integration combines the reviewed Workbench slices for the next product generation while preserving the accepted security boundaries.

Included runtime/domain work covers:
- prepared offline map Settings/API/repository/context work;
- Smart Street/House candidate and selection geometry;
- accepted ADR-0013 Smart Task identity with application-owned Task ids and OSM provenance only;
- Smart Street reviewed LineString snapshots and persistence contract;
- pickup/collection domain and UI foundations;
- Field Session draft/history/metrics foundations;
- comments, automation signals and progress/statistics foundations;
- Live Group draft/discovery/tour UI foundations without shipping the blocked credential runtime;
- app-like navigation, active Team context, appearance and Support/Feedback surfaces;
- Organizer/Admin Workbench, templates, action setup, analytics/export and role-template modeling;
- dedicated security regression matrix and static source guards.

Account/password/TOTP/Organization permission runtime remains intentionally excluded. ADR-0015 and ADR-0016 plus the identity threat model remain review gates before that runtime is implemented.

Live Group QR/code/password credential runtime remains intentionally excluded until ADR-0014 is accepted with its remaining security details.

## M6 Smart Street persistence rollout

ADR-0013 is accepted:
- durable Street/House Task identity is application-owned;
- OSM ids are source provenance only;
- reviewed Street geometry is persisted as a Campaign-owned LineString snapshot;
- OSM refresh must not silently rewrite Task identity or reviewed geometry/provenance.

`migrations/0004_m6_task_source_provenance.sql` adds nullable `tasks.source_json` for Smart Street source provenance. It is additive and is not yet recorded as remotely applied.

The Worker is deliberately backward-compatible with a pre-0004 D1 database:
- Campaign reads detect whether `source_json` exists and use `NULL AS source_json` on the old schema;
- existing/manual Tasks remain readable and writable before migration;
- legacy snapshot replacement uses the old Task insert when the column is absent;
- Smart Street writes that contain provenance are refused before any revision claim with `schema_migration_required` until 0004 is intentionally applied;
- provenance is never silently discarded to make an old database accept a Smart Street write.

This compatibility boundary allows application releases to remain safe while migration rollout is handled explicitly.

## Security/release gates

The release candidate is required to pass together:
- complete automated test suite;
- strict TypeScript check;
- production build;
- static source guards covering unsafe HTML/code execution, Worker logging, SQL interpolation, forbidden Service Worker/PWA behavior and continuous GPS watch;
- high-severity dependency audit;
- Cloudflare Worker build/preview verification.

Release branches run CI directly in addition to pull-request CI so integration fixes are tested before promotion.

Prepared/parameterized SQL remains mandatory. External/user-controlled content renders inertly. IDs are selectors, not authorization. Worker-side scope checks remain authoritative. Secrets, session material and future password/TOTP/recovery data must never be logged.

## Architecture still blocked for later milestones

Do not silently implement:
- Organization account/password/TOTP/session runtime before accepted ADR-0015 and threat-model review;
- configurable capability enforcement before accepted ADR-0016;
- Live Group credential runtime before accepted ADR-0014;
- any Service Worker/PWA/Background Sync path without a later accepted architecture decision;
- continuous GPS history for sessions/statistics/live groups.

## Immediate next

Finish the release integration gates on the exact candidate head. Only after tests, TypeScript, production build, dependency audit and Cloudflare preview are all green should the candidate be promoted to `main`. Migration 0004 remains a separate intentional D1 rollout step; until then Smart Street provenance writes fail explicitly and safely rather than corrupting or dropping data.

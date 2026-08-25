---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and M5 resilient mutation synchronization are merged on `main`.

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

## M5 completed

M5 resilient mutation synchronization merged through PR #24 on 2026-08-25.

Current foundation includes:
- IndexedDB-backed durable mutation queue;
- explicit Campaign/Team/Area/Street mutations;
- Worker/D1 idempotency ledger from migration `0003_m5_mutations.sql`;
- target-specific conflict detection;
- reconnect/visibility/manual retry;
- durable retry and access-blocked queue states;
- server-side authorization on every mutation;
- compact sync state UI.

Final browser acceptance confirmed:
- loaded-app offline mutation reconnects and reaches saved state;
- an online reload shows the intended change once without duplicate effect;
- saved Areas/Streets remain visible/selectable and active editing still works.

A strict full cold page reload while completely offline can still show Chrome's normal offline/Dino page before application JavaScript runs. This remains outside M5 under the accepted no-Service-Worker website architecture.

Historical plan:
- `docs/plans/completed/010-m5-resilient-mutation-sync.md`.

## Active next slice: prepared offline area

`docs/plans/active/011-offline-map-area.md` is now the next connectivity/map slice.

Target:
- deliberately prepare approximately 3 km around current map center;
- store offline-permitted OSM/OSM-derived map data in browser IndexedDB;
- keep geographic context available after connectivity loss while the website is already loaded;
- reuse the reviewed data pipeline for M6 Smart Streets/Houses where practical.

Before implementation, an ADR must decide provider/source, license/attribution, package format, zoom/detail limits, storage/versioning, update policy and rendering fallback.

Do not intentionally cache/store the current CARTO raster basemap.

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

Before M8 account implementation, an accepted ADR/threat model must define:
- password hashing;
- TOTP secret protection;
- account sessions/recovery;
- rate limiting;
- role/capability evaluation;
- legacy Campaign Admin migration.

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
- GitHub #22, desktop bottom-toolbar fit/spacing;
- GitHub #23, production health/recovery/diagnostics and dense Street validation.

## Immediate next

1. Execute Plan 011 from the merged M5 baseline.
2. Make the required offline map source/package ADR before implementation.
3. Keep Plan 012 as the umbrella sequence for later platform slices.
4. Do not start M8 accounts/permissions before the required security ADR/threat model is accepted.

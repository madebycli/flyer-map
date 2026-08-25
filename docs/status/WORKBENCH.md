---
id: status-workbench
type: status
status: experimental
last_updated: 2026-08-25
related: [plan-011-offline-map-area, plan-012-platform-app-expansion, ADR-0012]
---

# Unattended Workbench

This file describes experimental work on `workbench-unattended-platform` only.

It does not declare `main` stable behavior and must not be treated as a release record until the relevant slices are reviewed and intentionally promoted.

## Branch policy

- do not merge workbench changes to `main` automatically;
- keep dependent work stacked on non-main branches;
- continue only already-decided or architecture-neutral work;
- record decisions that need product/architecture approval instead of guessing them;
- account/password/TOTP/permissions implementation remains blocked by the required accepted ADR/threat model.

## Prepared offline map

Parent Draft PR #28 (`m55-offline-map-settings`) contains Plan 011 Slice 3 Settings UX and is intentionally still unmerged.

Workbench Draft PR #29 is stacked on that branch and contains Slice 4 renderer work:
- persistent MapLibre GeoJSON sources for prepared OSM roads/buildings;
- prepared context hidden while online;
- CARTO raster hidden while offline;
- prepared OSM context shown while offline when a valid local package exists;
- Campaign Area/Street layers remain above prepared context;
- local package changes propagate to the renderer through a browser-local event;
- renderer reloads the package on online/offline and visibility transitions;
- OSM attribution is visible when prepared context is active;
- renderer diagnostics expose offline-context state and feature counts;
- no Service Worker/PWA, tile bulk cache or new map renderer.

Automated evidence:
- CI #293 passed initial Slice 4 TypeScript/tests/build;
- CI #294 passed after lifecycle cleanup correction;
- CI #295 passed after final badge/style work on commit `c3e653b1f39fc78b2d8bb514f57abb38742f5ece`.

Still not proven without real browser/device acceptance:
- actual dense 3 km package visual quality/performance on a field phone;
- online download -> loaded-app offline transition -> local context visible;
- Campaign Area/Street selection/edit remains correct over dense offline context;
- M5 queued mutation/reconnect regression with offline context active.

## Decisions deliberately deferred

### M6 Street/House identity and splitting

Do not choose persistence identity, road splitting or house-task identity without the required M6 ADR.

Architecture-neutral work may prepare geometry predicates and candidate extraction from the accepted `OfflineMapPackage v1` OSM identities.

### Statistics retention

Do not add long-term analytics/session rollup tables before the event/session/statistics retention ADR.

Architecture-neutral work may calculate current Campaign/Team/Area progress directly from current domain Tasks with explicit denominators.

### Live Field Groups

Do not implement QR/code/password credentials or discoverability persistence before the dedicated live-group ADR.

### Organizations / accounts / permissions

Do not implement username/password/TOTP, Organization tenant persistence or configurable capability enforcement before the dedicated identity/permission ADRs and threat model.

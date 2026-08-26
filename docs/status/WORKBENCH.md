---
id: status-workbench
type: status
status: experimental
last_updated: 2026-08-26
related: [plan-011-offline-map-area, plan-012-platform-app-expansion, plan-015-m6-house-persistence, ADR-0012, ADR-0013]
---

# Integrated Workbench

This file records the reviewed experimental slices collected by the release integration branch. `docs/status/CURRENT.md` remains the concise release-state entrypoint.

## Accepted boundaries carried into integration

- Website only: no native app, installable PWA, Service Worker, Web App Manifest or Background Sync.
- MapLibre GL JS remains pinned at 5.7.1.
- CARTO remains online-only; no CARTO/OSMF bulk tile cache.
- Prepared OSM working-area data is browser-local in dedicated IndexedDB storage.
- Worker authorization remains authoritative.
- Prepared/parameterized D1 SQL only.
- No continuous GPS tracking/history.
- Account/password/TOTP/permission runtime remains blocked by ADR-0015/0016 and threat-model review.
- Live Group credential runtime remains blocked by ADR-0014 review.

## Prepared offline map

Integrated work includes the prepared package API/repository/lifecycle, Settings controls and MapLibre prepared context. The package remains bounded, Campaign-scoped and separate from the M5 mutation queue.

Real-device dense-area acceptance remains an operational field test rather than a reason to introduce a second renderer or Service Worker.

## M6 Smart Street/House

ADR-0013 is accepted.

Confirmed persistence contract:
- Street/House Task ids are application-owned generated ids;
- OSM ids are provenance only;
- reviewed OSM-derived geometry is copied into Campaign-owned snapshots;
- later OSM refresh may propose differences but must not silently rewrite Task id, geometry or provenance.

### Smart Street

Integrated Smart Street work includes candidate extraction, point anchors, route selection, preview, application-owned Task snapshot creation, mutation validation and persistence-facing provenance support.

Street geometry remains one continuous LineString. First/last source sections are clipped at reviewed anchors, multi-way selections are ordered/oriented/stiched continuously and invalid/disconnected routes fail visibly.

`migrations/0004_m6_task_source_provenance.sql` adds nullable `tasks.source_json` and is not recorded as remotely applied.

Pre-0004 compatibility:
- reads alias missing provenance as NULL;
- manual Tasks remain readable/writable;
- legacy snapshot replacement uses the legacy Task insert;
- Smart Street provenance writes are blocked before revision claim with `schema_migration_required`;
- provenance is never silently discarded.

### House persistence

Plan 015 adds a durable House Task foundation while deliberately leaving the current Street renderer/progress denominator unchanged.

Implemented House contract:
- optional `CampaignSnapshot.houseTasks` collection, backwards-compatible with older schema-v3 snapshots;
- application-owned `task_*` House ids, unique against Street ids inside the snapshot;
- reviewed Polygon building footprint;
- optional OSM source with exactly one positive Way id;
- optional parent Street constrained to the same Campaign and Area;
- shared Task status vocabulary;
- dedicated `house.create`, `house.rename`, `house.set-status`, `house.delete` mutations on the existing M5 queue/idempotency/revision protocol;
- Worker validation and Team Editor scope enforcement;
- reviewed House geometry/source/parent immutability;
- parent relation clears when its Street is deleted rather than deleting the House.

`migrations/0005_m6_house_tasks.sql` is additive and is not remotely applied by the implementation branch.

Pre-0005 compatibility:
- Street reads/writes remain unchanged;
- Campaign reads do not query a missing `house_tasks` table;
- any House write fails before Campaign revision claim with `schema_migration_required`;
- House data is never silently dropped or coerced into `tasks`.

The first complete Plan-015 implementation head passed tests, TypeScript, dependency audit, production build and Cloudflare Workers preview. The final documentation head must pass the same gates before merge.

### Renderer follow-up

Durable House data does not yet enter `vf-streets`. A dedicated follow-up must add batched House Polygon source/layers, rendered-feature selection and dense real-device acceptance. Do not render one React/SVG element or one MapLibre layer per House.

## Platform foundations integrated

Architecture-neutral and previously reviewed slices collected into the release candidate include:
- pickup/collection modeling and panel;
- Field Session draft/history/metrics;
- comments and automation signals;
- Campaign/Team/Area progress and statistics;
- Live Group draft/discovery/tour presentation without blocked credential persistence;
- unified platform navigation over the primary field map;
- appearance settings;
- Support/Feedback diagnostics with data minimization;
- Organizer/Admin Workbench surfaces;
- action templates, action setup, analytics comparison/export and role-template modeling.

Proposed Organization/account/permission documents remain proposals and do not authorize their sensitive runtime.

## Security hardening in the integration candidate

The candidate contains regression coverage for mutation identity, hostile OSM provenance, House parent/scope validation, parameterized SQL, cross-Campaign boundaries, comments, Live Group model boundaries and diagnostics data minimization.

Static guards reject:
- `dangerouslySetInnerHTML` in application/Worker source;
- `eval` and `new Function` execution;
- `document.write` and `insertAdjacentHTML` sinks;
- credential-like browser-storage writes;
- Worker console logging sinks;
- interpolated template expressions inside prepared SQL;
- Service Worker/web-manifest registration;
- continuous geolocation watch.

The normal release check also runs a high-severity dependency audit after tests, TypeScript and production build.

## Remaining decisions / implementation slices

Still intentionally deferred:
- ADR-0014 final Live Group join-code/QR/password/discoverability credential policy;
- ADR-0015 Organization Admin identity, password/TOTP/session/recovery policy;
- ADR-0016 configurable capability/role enforcement;
- durable Field Session event/history persistence until its decision is accepted;
- durable Action/Templates/Analytics persistence until its decision is accepted;
- House MapLibre runtime layer and House-specific progress denominator;
- intentional remote rollout/acceptance of migrations 0004 and 0005;
- any later architecture change that would permit PWA/Service Worker behavior.

## Release rule

The integration candidate must not be promoted merely because individual Workbench slices were green. Promotion requires the exact final head to pass the combined automated suite, TypeScript, production build, dependency audit and Cloudflare build/preview verification. Mainline and remote D1 rollout are separate actions and must each be verified after execution.

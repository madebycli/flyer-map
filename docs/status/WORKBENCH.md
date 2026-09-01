---
id: status-workbench
type: status
status: experimental
last_updated: 2026-08-26
related: [plan-011-offline-map-area, plan-012-platform-app-expansion, ADR-0012, ADR-0013]
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
- the reviewed Smart Street selection becomes the Campaign-owned geometry snapshot;
- initial persisted Street geometry is one continuous GeoJSON-compatible LineString;
- first and last source sections are clipped at the reviewed snapped anchors;
- multi-way selections are ordered, oriented and stitched continuously;
- adjacent duplicate coordinates are removed;
- invalid/disconnected routes fail visibly instead of silently falling back to MultiLineString;
- later OSM refresh may propose differences but must not silently rewrite Task id, geometry or provenance.

Integrated Smart Street work includes candidate extraction, point anchors, route selection, preview, application-owned Task snapshot creation, mutation validation and persistence-facing provenance support.

House selection is represented in the geometry/domain/UI workbench, but durable House persistence still requires its explicit additive schema slice.

### Migration 0004 compatibility

`migrations/0004_m6_task_source_provenance.sql` adds nullable `tasks.source_json` and is not recorded as remotely applied.

The integrated Worker now supports both schema states safely:
- pre-0004 reads alias missing provenance as NULL;
- manual Tasks remain readable/writable;
- pre-0004 legacy snapshot replacement uses the legacy Task insert;
- Smart Street provenance writes are blocked before the revision claim with `schema_migration_required`;
- no fallback is allowed to silently discard provenance.

After 0004 is intentionally applied, the same runtime starts storing validated OpenStreetMap way provenance through parameterized `source_json` bindings.

## Platform foundations integrated

Architecture-neutral and previously reviewed slices collected into the release candidate include:
- pickup/collection modeling and panel;
- Field Session draft/history/metrics;
- comments and automation signals;
- Campaign/Team/Area progress and statistics;
- Live Group draft/discovery/tour presentation without blocked credential persistence;
- mobile navigation, active Team context and field action bar;
- appearance settings;
- Support/Feedback diagnostics with data minimization;
- Organizer/Admin Workbench surfaces;
- action templates, action setup, analytics comparison/export and role-template modeling.

Proposed Organization/account/permission documents remain proposals and do not authorize their sensitive runtime.

## Security hardening in the integration candidate

The candidate contains a dedicated regression matrix covering mutation identity, hostile OSM provenance, parameterized SQL, cross-Campaign boundaries, comments, Live Group model boundaries and diagnostics data minimization.

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

## Remaining decisions

Still intentionally deferred:
- ADR-0014 final Live Group join-code/QR/password/discoverability credential policy;
- ADR-0015 Organization Admin identity, password/TOTP/session/recovery policy;
- ADR-0016 configurable capability/role enforcement;
- durable House persistence schema;
- any later architecture change that would permit PWA/Service Worker behavior.

## Release rule

The integration candidate must not be promoted merely because individual Workbench slices were green. Promotion requires the exact final head to pass the combined automated suite, TypeScript, production build, dependency audit and Cloudflare build/preview verification. Mainline and remote D1 rollout are separate actions and must each be verified after execution.

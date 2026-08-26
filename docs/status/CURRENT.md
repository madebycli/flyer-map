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

M4 access/session authorization, M5 resilient mutation synchronization and the M5.5 prepared-offline-map storage lifecycle are established foundations.

## Unified platform UI

Plan 014 is completed and verified. The normal website starts in one unified platform shell instead of requiring separate Workbench query URLs to discover the newer UI foundations.

The map remains mounted as the primary field workspace. Integrated modules include live Campaign progress, operational comments/Pickup/Field Session foundations, Smart Streets/Houses, Live Groups, Actions/Analytics, Support and authorized Admin foundations.

The old `?workbench=ui|m6|admin|groups|actions` routes remain available for development and review compatibility.

Local Foundation UI does not imply durable server persistence. Comments/Pickup/Field Session integration remains explicitly local until the corresponding reviewed persistence slices are implemented. Admin/Live Group security-gated surfaces continue to show only non-authoritative Foundation behavior.

The stable integration preview alias remains:
`https://release-platform-integration-2026-08-26-flyer-map.cloudflare-eleven035.workers.dev`

## M6 Street and House persistence

ADR-0013 is accepted:
- durable Street/House identity is application-owned;
- OSM ids are provenance only;
- reviewed geometry becomes Campaign-owned snapshot data;
- later OSM refreshes must not silently rewrite Task identity or reviewed geometry/provenance.

### Smart Street

`migrations/0004_m6_task_source_provenance.sql` adds nullable `tasks.source_json` for Smart Street provenance. It is prepared but is not recorded as remotely applied.

Before 0004:
- existing/manual Street Tasks remain readable/writable;
- Smart Street provenance writes fail before Campaign revision claim with `schema_migration_required`;
- provenance is never silently discarded.

### House Tasks

Plan 015 adds the durable House persistence foundation without changing the established Street renderer/progress denominator:
- optional `CampaignSnapshot.houseTasks` extension;
- application-owned House Task ids;
- reviewed Polygon building snapshots;
- optional exactly-one-Way OSM provenance;
- optional parent Street Task constrained to the same Campaign and Area;
- House create/rename/status/delete through the existing M5 queue/idempotency/revision model;
- Worker-side scope validation for Admin/Team Editor/Viewer;
- reviewed House geometry/source/parent immutability;
- parent relationship clears safely when its Street is deleted.

`migrations/0005_m6_house_tasks.sql` adds the separate `house_tasks` table. It is additive and is **not remotely applied** by this development slice.

Before 0005:
- Street reads/writes continue normally;
- House reads do not query a missing table;
- House writes fail explicitly with `schema_migration_required` before revision claim;
- House data is never silently dropped or stored as a Street.

House rendering remains a deliberate follow-up. `vf-streets` continues to contain only Street LineStrings until a batched House Polygon layer is implemented and density-tested.

The House persistence feature branch is `m6-house-persistence-runtime`, with Draft PR #70 based on the unified release branch. Its first complete implementation head passed tests, TypeScript, dependency audit, production build and Cloudflare Workers preview. Subsequent documentation-only commits still require the same final-head verification before merge.

## Release integration candidate

The wider platform candidate also includes:
- prepared offline map Settings/API/repository/context work;
- Smart Street/House candidate and selection geometry;
- pickup/collection domain and UI foundations;
- Field Session draft/history/metrics foundations;
- comments, automation signals and progress/statistics foundations;
- Live Group draft/discovery/tour UI foundations without blocked credential runtime;
- app-like navigation, active Team context, appearance and Support/Feedback surfaces;
- Organizer/Admin Workbench, templates, action setup, analytics/export and role-template modeling;
- dedicated security regression matrix and static source guards.

Account/password/TOTP/Organization permission runtime remains intentionally excluded. ADR-0015 and ADR-0016 plus the identity threat model remain review gates before that runtime is implemented.

Live Group QR/code/password credential runtime remains intentionally excluded until ADR-0014 is accepted with its remaining security details.

Durable Field Session/domain-event persistence and durable Action/Templates/Analytics persistence remain behind their proposed architecture/ADR gates.

## Security/release gates

Every promoted integration head must pass together:
- complete automated test suite;
- strict TypeScript check;
- production build;
- high-severity dependency audit;
- static source guards;
- Cloudflare Worker build/preview verification.

Prepared/parameterized SQL remains mandatory. External/user-controlled content renders inertly. IDs are selectors, not authorization. Worker-side scope checks remain authoritative. Secrets, session material and future password/TOTP/recovery data must never be logged.

## Architecture still blocked for later milestones

Do not silently implement:
- Organization account/password/TOTP/session runtime before accepted ADR-0015 and threat-model review;
- configurable capability enforcement before accepted ADR-0016;
- Live Group credential runtime before accepted ADR-0014;
- durable Field Session event history before its accepted retention/event decision;
- durable Action/Templates/Analytics persistence before its accepted architecture decision;
- any Service Worker/PWA/Background Sync path without a later accepted architecture decision;
- continuous GPS history for sessions/statistics/live groups.

## Immediate next

Finish PR #70 on its exact final head and merge it into the unified release branch only if all gates remain green. Keep migrations 0004 and 0005 as separate intentional D1 rollout operations. After the House persistence foundation, the next M6 product slice is the batched House map/runtime interaction layer rather than weakening any security gate.

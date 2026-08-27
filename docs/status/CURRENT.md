---
id: status-current
type: status
status: active
last_updated: 2026-08-27
---

# Current Project State

## Product baseline

Verteil-Flyer is a mobile-first normal website. The architecture still explicitly excludes native app runtime, installable PWA behavior, Service Worker, Web App Manifest and Background Sync.

The field map remains MapLibre GL JS 5.7.1 with the CARTO online basemap. Prepared offline OSM context is stored separately in browser IndexedDB and does not bulk-cache CARTO/OSMF tiles.

M4 access/session authorization, M5 resilient mutation synchronization and the M5.5 prepared-offline-map storage lifecycle are established foundations.

## Delivery direction

Plan 017 changes the implementation model from normal-product Foundation previews to vertical feature-complete delivery.

A visible Launcher module is no longer considered delivered merely because local UI, fake data, domain helpers or a Workbench route exists. Shared features must include their real persistence, Worker authorization, offline/retry behavior where relevant, complete user states, tests and production verification before they count as complete.

Internal `?workbench=` routes may remain for development but are not normal product navigation and do not count as completed features.

The next prioritized feature-complete product area is the Team Hub + Live Field Group system. Durable Field Sessions/Activity/Comments and real statistics follow directly after it.

## Unified platform UI

The normal website starts in one unified platform shell while the map remains mounted as the primary field workspace.

Plan 016 defines the current mobile field chrome:
- permanent Team dropdown removed from the composed field UI;
- permanent Settings/Teams/Draw-Area toolbar removed from the composed browse chrome;
- bottom-left now shows only a compact 3x3 app-grid button plus the visible Team name, with Team color only as a supporting marker;
- former toolbar actions stay out of the permanent bottom bar and move into launcher/module flows according to effective permissions;
- the app menu is a rounded sheet over the map, visually aligned with the existing Settings/Teams sheet family;
- launcher destinations use large phone-style rounded icons with short labels such as Karte, Stats, Team, Feedback, Smart and Einsätze;
- selecting a launcher destination may still open its dedicated full module surface.

Before further feature work, FC0 in Plan 017 must make the new navigation functionally complete: the displayed Team name must follow the real active map Team, existing Settings/Team/Area actions must remain reachable through a typed PlatformShell/App bridge, and unfinished Foundation modules must not be offered as normal finished destinations.

Current integrated preview/foundation surfaces include Campaign progress, operational comments/Pickup/Field Session UI, Smart Streets/Houses, Live Groups, Actions/Analytics, Support and Admin. They remain development inputs until their corresponding feature-complete slices replace local/fake state with authoritative runtime behavior.

## M6 Street and House persistence

ADR-0013 is accepted: durable Street/House identity is application-owned, OSM ids are provenance only, reviewed geometry becomes Campaign-owned snapshot data, and later OSM refreshes must not silently rewrite Task identity or reviewed geometry/provenance.

### Smart Street

`migrations/0004_m6_task_source_provenance.sql` adds nullable `tasks.source_json` for Smart Street provenance. It is prepared but is not recorded as remotely applied.

Before 0004 existing/manual Street Tasks remain readable/writable, while Smart Street provenance writes fail before Campaign revision claim with `schema_migration_required`. Provenance is never silently discarded.

### House Tasks

Plan 015 adds the durable House persistence foundation without changing the established Street renderer/progress denominator:
- optional `CampaignSnapshot.houseTasks` extension;
- application-owned House Task ids;
- reviewed Polygon building snapshots;
- optional exactly-one-Way OSM provenance;
- optional parent Street Task constrained to the same Campaign and Area;
- House create/rename/status/delete through the existing M5 queue/idempotency/revision model;
- Worker-side scope validation;
- reviewed House geometry/source/parent immutability;
- parent relationship clears safely when its Street is deleted.

`migrations/0005_m6_house_tasks.sql` adds the separate `house_tasks` table. It is additive and is not remotely applied by development work.

Before 0005 Street reads/writes continue normally, House reads do not query a missing table, and House writes fail explicitly with `schema_migration_required` before revision claim.

House rendering remains a deliberate feature-complete follow-up. `vf-streets` continues to contain only Street LineStrings until a batched House Polygon layer is implemented and density-tested.

## Security/release gates

Every promoted integration head must pass the automated test suite, strict TypeScript check, production build, high-severity dependency audit, static source guards and Cloudflare Worker build/preview verification.

Prepared/parameterized SQL remains mandatory. External/user-controlled content renders inertly. IDs are selectors, not authorization. Worker-side scope checks remain authoritative. Secrets, session material and future password/TOTP/recovery data must never be logged.

## Architecture still blocked for later milestones

Do not silently implement Organization account/password/TOTP/session runtime before accepted ADR-0015 and threat-model review, configurable capability enforcement before accepted ADR-0016, Live Group credential runtime before accepted ADR-0014, durable Field Session event history before accepted ADR-0017, durable Action/Templates/Analytics persistence before accepted ADR-0018, Service Worker/PWA/Background Sync, or continuous GPS history.

## Immediate next

1. Keep the current stacked release/House/launcher PR state explicit and verify exact heads before promotion or retargeting.
2. Complete Plan 017 FC0 navigation/action bridge so the bottom launcher is the authoritative product navigation without losing Settings/Team/Area actions.
3. Finalize and explicitly accept the remaining ADR-0014 decisions.
4. Build Team Hub + Live Field Groups end-to-end with real D1/API credentials, membership, QR/Room Code, participant count, close/expiry, authorization and multi-device behavior.
5. Finalize ADR-0017 and attach durable Field Sessions/events directly to the finished group flow.
6. Keep migrations 0004 and 0005 as separate intentional D1 rollout operations until explicitly authorized.

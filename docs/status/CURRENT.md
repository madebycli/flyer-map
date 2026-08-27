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

The current prioritized feature-complete product area is the Team Hub + Live Field Group system. Its main runtime is now implemented on Draft PR #72. Remaining FC1 product gaps are completed before moving fully into the broader FC2 collaboration surface.

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

FC0 navigation/action bridging is established on the current PR #72 stack: the launcher uses the typed platform action bridge, the visible Team follows the active map context, core Settings/Team/Area actions remain reachable according to effective permissions, and `Team` opens the real Team Hub instead of the old Workbench preview.

Current integrated preview/foundation surfaces still include broader comments/Pickup/Field Session history UI, Smart Streets/Houses, Actions/Analytics, Support and Admin. They remain development inputs until their corresponding feature-complete slices replace local/fake state with authoritative runtime behavior.

## FC1 Team Hub and Live Field Groups

ADR-0014 is accepted and the current PR #72 runtime implements the first real Field Group lifecycle:
- Team Hub as the normal `Team` launcher destination;
- Campaign-scoped active group discovery and Team filter;
- Admin and own-Team Editor group management boundaries;
- create with label, Team, discoverability and participant count;
- human-safe 10-character Room Code plus separate 256-bit QR token;
- only credential hashes persisted, plaintext shown only at issuance/rotation;
- actor and candidate Cloudflare Rate Limiting bindings with fail-closed join behavior;
- QR and manual Room-Code join;
- temporary `vf_field_group_session` for users without persistent Campaign access;
- temporary access scoped to one Campaign/Team/Group and restricted to reviewed Task-status work;
- update participant count/discoverability, rotate/revoke credentials, leave/remove membership API and manual close;
- server-enforced hard expiry no later than 24 hours from original group creation;
- idempotent create, update, rotation, revoke, join, leave, remove and close semantics;
- Create/Rotate request ids survive client network retries without storing plaintext secrets for replay;
- Team progress is derived from the real Campaign snapshot, with Street and House denominators shown separately;
- revoked/closed/expired temporary access is re-authorized on protected requests and cannot silently keep privileged sync alive.

The remaining visible FC1 gap currently identified is manager-side membership listing/removal UX. The remove endpoint exists, but the Team Hub does not yet expose a safe member roster to drive it.

## Durable Field Session close history

ADR-0017 is accepted.

`migrations/0007_field_sessions_events.sql` is prepared as the first minimal durable Field Session/Event slice. It adds:
- `field_sessions`;
- minimized append-only `domain_events`;
- one deterministic Field Session per Field Group;
- deduplicated `field_session.closed` history for manual close;
- `field_session.expired` history for the 24-hour safety fallback;
- duration and explicit participant/person-time metrics;
- unknown participant/person-time stays `NULL` for expired forgotten groups instead of being fabricated;
- no GPS trail, secret material or full Campaign snapshot history.

The Worker blocks manual Field Group close with `field_session_schema_unavailable` until the 0007 schema is present. Once 0007 is present, SQLite triggers bind the authorized `active -> closed` or `active -> expired` group state transition to its durable Field Session/Event in the same D1 transaction. Existing closed/expired development groups are backfilled when 0007 is applied.

This is only the Field Group close/expiry foundation. Broader FC2 Session history reads, notes, Task-event attribution, comments, activity feed and automations are not yet feature complete.

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

## D1 rollout status

Remote-applied migration history remains only 0001 through 0003.

Prepared but deliberately **not remotely applied** on this development branch:
- 0004: Smart Street source provenance;
- 0005: House Tasks;
- 0006: FC1 Field Groups, credential idempotency and memberships;
- 0007: Field Sessions and minimized domain events.

None of these migrations is applied merely because PR #72 is green. Remote D1 rollout remains an explicit later operation.

## Security/release gates

Every promoted integration head must pass the automated test suite, strict TypeScript check, production build, high-severity dependency audit, static source guards and Cloudflare Worker build/preview verification.

Prepared/parameterized SQL remains mandatory. External/user-controlled content renders inertly. IDs are selectors, not authorization. Worker-side scope checks remain authoritative. Secrets, session material and future password/TOTP/recovery data must never be logged.

Current verified PR #72 checkpoint before this documentation update:
- head `13ab3f37d2e70c5db76584ecf5e2414b080ae600`;
- CI #615 completed successfully with tests, strict TypeScript check, dependency audit and production build green.

Any later documentation/runtime commit must be verified on its own exact head before promotion.

## Architecture still blocked for later milestones

Do not silently implement Organization account/password/TOTP/session runtime before accepted ADR-0015 and threat-model review, configurable capability enforcement before accepted ADR-0016, durable Action/Templates/Analytics persistence before accepted ADR-0018, Service Worker/PWA/Background Sync, continuous GPS history, or broad FC2 comment/activity event persistence beyond accepted ADR-0017's active slice.

ADR-0014 and ADR-0017 are accepted and no longer architecture blockers for their implemented FC1 scopes.

## Immediate next

1. Finish FC1 manager-side Field Group membership listing/removal UX with server-authorized minimum member metadata.
2. Re-check the remaining FC1 acceptance list, especially Team archival behavior now that ADR-0017 retention is accepted, without introducing unsafe Team hard delete.
3. Keep 0004 through 0007 as separate intentional D1 rollout operations until explicitly authorized.
4. Keep PR #72 draft and verify the exact current head after every runtime/documentation change.
5. After FC1 is genuinely complete, continue FC2 with durable Session history reads, Task-event attribution, comments/activity and deterministic automations under accepted ADR-0017.

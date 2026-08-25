---
id: status-workbench
type: status
status: experimental
last_updated: 2026-08-26
related: [plan-011-offline-map-area, plan-012-platform-app-expansion, ADR-0012]
---

# Unattended Workbench

This file describes experimental non-main work only.

It does not declare `main` behavior and must not be treated as a release record until relevant slices are intentionally reviewed and promoted.

## Branch policy

- never merge workbench changes to `main` automatically;
- keep dependent work stacked on non-main branches;
- continue already-decided, presentation-only or architecture-neutral work without inventing unresolved persistence/security behavior;
- record decision points explicitly;
- account/password/TOTP/permissions and temporary Live Group credentials remain blocked by proposed ADR review and threat-model gates;
- no Service Worker, installable PWA or Background Sync is introduced.

## Prepared offline map

Parent Draft PR #28 (`m55-offline-map-settings`) contains Plan 011 Slice 3 Settings UX and remains unmerged.

Workbench Draft PR #29 (`workbench-unattended-platform`) is stacked on #28 and contains Plan 011 Slice 4 plus neutral foundations:
- persistent MapLibre GeoJSON sources for prepared OSM roads/buildings;
- prepared context hidden while online;
- CARTO raster hidden while offline;
- prepared OSM context shown while offline when a valid local package exists;
- Campaign Area/Street layers remain above prepared context;
- local package changes propagate through a browser-local event;
- renderer reloads package on connectivity/visibility transitions;
- OSM attribution and renderer diagnostics;
- current Campaign/Team/Area progress helpers;
- architecture-neutral OSM Area intersection helpers.

Latest root-workbench CI evidence: #301 passed.

Real browser/device acceptance is still required before Plan 011 can be considered complete:
- dense 3 km visual quality/performance on a field phone;
- online download -> loaded-app offline transition -> local context visible;
- Campaign Area/Street selection/edit over dense offline context;
- M5 queued mutation/reconnect regression with offline context active.

## App, support and field UI

- PR #30: app-menu model, privacy-safe Support diagnostics, Field Session metrics. CI #302 passed. Campaign context in Support diagnostics is opt-in only.
- PR #31: Team palette starts Orange, Blue, Green, Red, Gray and contains 12 unique presets. CI #303 passed.
- PR #32: reusable app menu, progress, Team context and Support/Feedback UI surfaces. CI #304 passed.
- PR #37: isolated `?workbench=ui` visual preview using fake/local data. Normal application route remains unchanged. CI #311 passed.
- PR #35: local System/Light/Dark appearance preference, no server state. CI #307 passed.
- PR #36: current Campaign/Team/Area progress overview, no historical analytics. CI #308 passed.
- PR #43: controlled Field Session draft UI for distribution/collection, duration/people/note only, no persistence/GPS. CI #317 passed.
- PR #44: presentation-only desktop Admin shell with explicit `authorized` input and sensitive future modules marked planned. CI #318 passed.
- PR #45: compact mobile field action bar for Settings/Teams/Menu plus optional primary Area action. CI #319 passed.

## Collaboration and automations

- PR #33: comment draft validation and deterministic progress/sync automation signals; read-only Automation Signals UI; no side effects, polling or persistence. Initial CI #305 passed; latest UI extension re-check is pending/current separately.
- PR #42: controlled comments list/composer with explicit context and read-only mode; no network, storage or moderation policy. CI #316 passed.

Long-term comments/activity/session/statistics storage remains blocked by a retention/event-model decision.

## Smart Streets and Houses

- PR #34: OSM road/building candidates intersecting an Area; source `way/...` identity and reviewed road/address tags retained. CI #306 passed.
- PR #38: two testable Street selection modes, clicked source segment vs connected same-name segments. CI #312 passed.
- PR #39: isolated `?workbench=m6` comparison preview. CI #313 passed.
- PR #40: individual/multi House selection and same-street building bulk selection. CI #314 passed.
- PR #46: proposed ADR-0013. Recommended durable Task identity is application-owned generated ids with separate OSM provenance and reviewed geometry snapshots. CI #320 passed. ADR remains proposed.

Still unresolved before M6 persistence:
- default Street click scope: one OSM segment or connected same-name segments;
- persisted representation for one logical Street built from multiple source ways;
- explicit acceptance of ADR-0013.

No M6 D1 schema or Task-write path exists in the workbench.

## Collection / Pickup

PR #41 contains an independent Pickup model plus controlled UI:
- `open`, `collected`, `unavailable`, `needs-follow-up`;
- manual bounded address/note input;
- optional reviewed OSM building source reference;
- separate `pickup-tasks` progress denominator;
- no flyer-status coupling, D1 persistence, GPS or driven-route storage.

CI #315 passed the domain slice. UI extension has its own current re-check.

## Security-sensitive architecture proposals

PR #47 contains documentation only, no runtime code/migrations:
- proposed ADR-0014: Live Field Group lifecycle/discovery/manual code/QR credential boundaries;
- proposed ADR-0015: Organization Admin username/password/TOTP/session design;
- proposed identity threat model covering injection, XSS, brute force, TOTP replay, session fixation, CSRF, tenant isolation, last-admin concurrency and secret logging;
- proposed ADR-0016: named role templates + explicit capabilities, deny by default, no per-user exceptions in v1 proposal;
- context graph routes future security-sensitive work through these documents.

CI #321 passed.

Security implementation remains blocked until explicit review/acceptance. In particular:
- no account table;
- no password/TOTP runtime;
- no permission-write runtime;
- no QR/manual Live Group join endpoint;
- no raw password/TOTP/recovery/session secret logging or plaintext persistence;
- future D1 statements remain prepared/parameterized.

## Open product/architecture decisions

1. Smart Street default click scope: clicked segment vs connected same-name road.
2. ADR-0013 final multi-way Street geometry/persistence details.
3. Event/Field Session/statistics long-term retention model.
4. Comment edit/delete/moderation/actor semantics before persistence.
5. Live Group J1 vs J2: join only after existing Campaign authorization, or QR/code may bootstrap temporary Field-Group-scoped access.
6. Admin username canonicalization policy.
7. Secure Worker password-verifier benchmark/runtime path.
8. Whether account recovery codes are mandatory and catastrophic all-admin recovery policy.
9. Admin session idle/absolute lifetime.
10. Capability-role delegation and legacy Campaign access-link coexistence.

## Promotion rule

A workbench slice may be considered for stable promotion only after:
- its dependencies are intentionally promoted in order;
- final-head CI is green;
- relevant ADRs are accepted;
- required browser/mobile acceptance is recorded;
- security release gates apply to any security-sensitive subsystem;
- documentation is updated to distinguish shipped behavior from experiments.

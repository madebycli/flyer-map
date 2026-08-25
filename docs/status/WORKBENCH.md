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
- PR #43: controlled Field Session draft + history UI for distribution/collection, duration/people/note and selection callback only. CI #330 passed after history extension.
- PR #44: presentation-only desktop Admin shell with explicit `authorized` input and sensitive future modules marked planned. CI #318 passed.
- PR #45: compact mobile field action bar for Settings/Teams/Menu plus optional primary Area action. CI #319 passed.

## Collaboration, history and automations

- PR #33: comment draft validation, deterministic progress/sync automation signals, read-only Automation Signals UI and proposed ADR-0017. Latest CI #337 passed after retention direction update.
- PR #42: controlled comments list/composer with explicit context and read-only mode; no network, storage or moderation policy. CI #316 passed.

Confirmed product direction for ADR-0017:
- retain meaningful operational Field Session/domain-event history with the Campaign;
- do not automatically expire history after 12/24 months;
- retention still excludes secrets, raw request bodies, continuous GPS trails and redundant full Campaign snapshots.

Still unresolved before history persistence:
- Campaign archive vs permanent delete behavior for retained history;
- whether past sessions need exact historical geometry or current Task geometry is enough;
- comment edit/delete/moderation event semantics.

## Smart Streets and Houses

- PR #34: OSM road/building candidates intersecting an Area; source `way/...` identity and reviewed road/address tags retained. CI #306 passed.
- PR #38: detailed Street start/end anchor selection. Street names no longer control selection extent. Unique connected topology selects the sections between anchors; disconnected or ambiguous networks fail visibly. Latest CI #334 passed.
- PR #39: isolated `?workbench=m6` start/end selection preview. Preview branch has been updated to the new interaction and awaits/re-runs its own final-head CI as applicable.
- PR #40: individual/multi House selection and same-street building bulk selection UI. Latest CI #328 passed.
- PR #46: proposed ADR-0013 updated to start/end anchor semantics, application-owned durable Task ids and separate OSM provenance. Latest CI #335 passed. ADR remains proposed.

Confirmed product direction:
- the user chooses a detailed Street section by clicking/tapping a beginning and an end;
- all unambiguous road source sections between those anchors are selected;
- selection must not expand by street name;
- a multi-kilometer same-name street is never automatically selected beyond the chosen end;
- the old rough marker workflow is replaced by clicking reviewed Street geometry rather than freehand drawing.

Still unresolved before M6 persistence:
- ambiguous junction UX: intermediate waypoint(s), route-candidate preview, or both;
- persisted geometry representation for a selected multi-way Street section;
- explicit acceptance of ADR-0013.

No M6 D1 schema or Task-write path exists in the workbench.

## Collection / Pickup

PR #41 contains an independent Pickup model plus controlled UI:
- `open`, `collected`, `unavailable`, `needs-follow-up`;
- manual bounded address/note input;
- optional reviewed OSM building source reference;
- separate `pickup-tasks` progress denominator;
- no flyer-status coupling, D1 persistence, GPS or driven-route storage.

Latest UI/domain CI #323 passed.

## Live Field Groups

PR #48 contains the first architecture-neutral online-groups list UI:
- list is scoped to the current Campaign/action;
- default filter is `Alle in der Aktion`;
- optional Team filter narrows the list;
- only active discoverable groups are shown;
- groups with `online anzeigen = false` do not appear;
- Team name/color remain visible;
- discovery data contains no room code, QR token or persistent access secret;
- join action is callback-only and performs no credential redemption.

CI #338 passed.

ADR-0014 in PR #47 records the confirmed discovery direction:
- a Field Group belongs to one Campaign + Team;
- room-code/QR concepts remain part of joining;
- creator/manager can control `online anzeigen`;
- default Campaign list scope is all visible groups in the action, with Team filter available;
- no public cross-Campaign directory.

Still unresolved before credential runtime:
- J1: existing Campaign authorization required before room-code/QR join;
- J2: valid room-code/QR may bootstrap temporary Field-Group-scoped access;
- whether `online anzeigen` defaults on/off for a newly created group;
- exact credential/group lifetime and rotation policy.

## Security-sensitive architecture proposals

PR #47 contains documentation only, no runtime code/migrations:
- proposed ADR-0014: Live Field Group lifecycle/discovery/manual code/QR credential boundaries;
- proposed ADR-0015: Organization Admin username/password/TOTP/session design;
- proposed identity threat model covering injection, XSS, brute force, TOTP replay, session fixation, CSRF, tenant isolation, last-admin concurrency and secret logging;
- proposed ADR-0016: named role templates + explicit capabilities, deny by default, no per-user exceptions in v1 proposal;
- context graph routes future security-sensitive work through these documents.

Latest CI #336 passed after the Live Group discovery clarification.

Security implementation remains blocked until explicit review/acceptance. In particular:
- no account table;
- no password/TOTP runtime;
- no permission-write runtime;
- no QR/manual Live Group join endpoint;
- no raw password/TOTP/recovery/session secret logging or plaintext persistence;
- future D1 statements remain prepared/parameterized.

## Open product/architecture decisions

1. Smart Street ambiguity UX: intermediate waypoint(s), route candidates, or both.
2. ADR-0013 final multi-way Street geometry/persistence details.
3. Campaign archive/permanent delete behavior for retained operational history.
4. Current Task geometry vs exact historical geometry for past-session map highlighting.
5. Comment edit/delete/moderation/actor semantics before persistence.
6. Live Group J1 vs J2: existing Campaign access required vs room-code/QR bootstraps temporary Field-Group-scoped access.
7. New Field Group `online anzeigen` default: on or off.
8. Admin username canonicalization policy.
9. Secure Worker password-verifier benchmark/runtime path.
10. Whether account recovery codes are mandatory and catastrophic all-admin recovery policy.
11. Admin session idle/absolute lifetime.
12. Capability-role delegation and legacy Campaign access-link coexistence.

## Promotion rule

A workbench slice may be considered for stable promotion only after:
- its dependencies are intentionally promoted in order;
- final-head CI is green;
- relevant ADRs are accepted;
- required browser/mobile acceptance is recorded;
- security release gates apply to any security-sensitive subsystem;
- documentation is updated to distinguish shipped behavior from experiments.

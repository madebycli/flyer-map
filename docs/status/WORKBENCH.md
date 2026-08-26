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

Latest root-workbench CI evidence before this status update: #301 passed.

Real browser/device acceptance is still required before Plan 011 can be considered complete:
- dense 3 km visual quality/performance on a field phone;
- online download -> loaded-app offline transition -> local context visible;
- Campaign Area/Street selection/edit over dense offline context;
- M5 queued mutation/reconnect regression with offline context active.

## App, support and field UI

- PR #30: app-menu model, privacy-safe Support diagnostics, Field Session metrics. CI #302 passed.
- PR #31: Team palette starts Orange, Blue, Green, Red, Gray and contains 12 unique presets. CI #303 passed.
- PR #32: reusable app menu, progress, Team context and Support/Feedback UI surfaces. CI #304 passed.
- PR #37: isolated `?workbench=ui` visual preview using fake/local data. CI #311 passed.
- PR #35: local System/Light/Dark appearance preference, no server state. CI #307 passed.
- PR #36: current Campaign/Team/Area progress overview. CI #308 passed.
- PR #43: controlled Field Session draft + history UI for distribution/collection. CI #330 passed.
- PR #44: presentation-only desktop Admin shell with explicit `authorized` input. CI #318 passed.
- PR #45: compact mobile field action bar. CI #319 passed.

## Collaboration, history and automations

- PR #33: comment draft validation, deterministic progress/sync automation signals, read-only Automation Signals UI and proposed ADR-0017. Latest confirmed CI #350 passed.
- PR #42: controlled comments list/composer; no network, storage or moderation policy. CI #316 passed.

Confirmed history direction:
- retain meaningful operational Field Session/domain-event history with the action;
- no automatic 12/24-month expiry for ordinary operational history;
- exact historical geometry reconstruction is not required for v1 reflection;
- current/reviewed Task geometry plus retained references is sufficient initially;
- history supports repeated-action comparison and future Admin analysis exports;
- retention still excludes credentials, raw request bodies, continuous GPS trails and redundant full snapshots.

Still unresolved before history persistence:
- archive vs permanent destructive deletion behavior;
- comment edit/delete/moderation event semantics;
- whether security/audit retention differs from ordinary operational history.

## Smart Streets and Houses

- PR #34: OSM road/building candidates intersecting an Area; source `way/...` identity and reviewed road/address tags retained. CI #306 passed.
- PR #38: detailed Street start/end anchor semantics plus route choices and waypoint correction. Latest CI #352 passed.
- PR #39: isolated `?workbench=m6` route/waypoint preview. Latest CI #354 passed and PR is correctly stacked on the current #38 head.
- PR #40: individual/multi House selection and same-street building bulk selection UI. CI #328 passed.
- PR #46: proposed ADR-0013 for application-owned Task identity, OSM provenance and reviewed geometry. Latest CI #349 passed. ADR remains proposed.

Confirmed Street interaction:
- first tap/click chooses detailed start road section;
- second chooses end road section;
- street names never determine selection extent;
- a unique connected shortest topological path is highlighted;
- equal plausible shortest paths are not guessed;
- ambiguity UX is **C: show bounded route candidates and allow intermediate waypoint clicks**;
- a user can deliberately force a different/longer path with waypoints;
- disconnected or bounded-too-complex routes fail visibly.

Still unresolved before M6 persistence:
- explicit acceptance of application-owned generated Task ids + separate OSM provenance;
- persisted geometry representation for a selected multi-way Street section.

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

PR #48 contains architecture-neutral online-groups behavior/UI:
- list is scoped to the current Campaign/action;
- default filter is `Alle in der Aktion`;
- optional Team filter narrows the list;
- only active discoverable groups are shown;
- **new Field Groups default to `online anzeigen = an`**;
- groups with `online anzeigen = false` do not appear;
- Team name/color remain visible;
- discovery data contains no room code, QR token or persistent access secret;
- join action is callback-only;
- pure creation defaults contain visibility/state only, never credentials/authority.

ADR-0014 in PR #47 records the confirmed access direction:
- Field Group belongs to one Campaign/action + Team;
- room code + separate QR join token are temporary credentials;
- valid room code/QR may bootstrap temporary Field-Group/Team-scoped access for somebody without prior Campaign access;
- temporary join must never grant persistent Team management, Admin or Organizer authority;
- offline-first join is not supported because initial credential redemption/revocation requires Worker access.

Still unresolved before credential runtime:
- credential expiry/rotation;
- maximum Field Group lifetime/close policy;
- exact temporary group-member capability matrix;
- rate-limit configuration and security test details.

## Organizer, Admin and permissions

PR #47 contains documentation only, no runtime code/migrations. Latest confirmed CI #348 passed.

Confirmed product hierarchy:
- Organization has **Organizer** role above normal Admin;
- Organizer can add/promote/disable Admins according to final re-authentication policy;
- Organizer manages Organization-wide permission/role policy;
- normal Admin does not automatically become Organizer or create Organizers;
- last effective Organizer must be protected transactionally;
- Admin/Organizer actions are server-authorized and audited;
- Admin-only analytics export uses an explicit capability such as `analytics.export`.

PR #47 also contains:
- proposed ADR-0015 username/password/TOTP/session design;
- identity threat model covering injection, XSS, brute force, TOTP replay, session fixation, CSRF, tenant isolation, last-authority concurrency and secret logging;
- proposed ADR-0016 named role templates/capabilities, deny by default;
- updated Organizations architecture.

No account table, password/TOTP runtime, permission-write runtime or Live Group credential endpoint exists.

## Reusable templates, actions and AI analytics

PR #49 (`workbench-action-templates-analytics`) is stacked on collaboration/history work, never `main`.

Proposed product/domain separation:
- **Action Template** = reusable planning blueprint;
- **Action/Aktion** = one concrete flyer distribution or clothes collection round with fresh state/history;
- **Field Session/Einsatz** = one outing/working session inside an action;
- optional **Action Cycle** can group a related Distribution Action and later Collection Action, e.g. Spring 2027;
- common twice-per-year workflow is supported but never hardcoded.

Template workbench behavior:
- copies Team structure/colors, Areas, map view and planned Street geometry;
- never copies completed status, old entity ids, Sessions, Field Groups, comments, pickup completion or credentials;
- new Distribution draft starts planned Streets `open`;
- new Collection draft reuses planning context but starts Pickup tasks empty;
- controlled Admin surface can create local Distribution/Collection drafts without persistence.

Admin analytics workbench:
- strict allowlist single-action export:
  - `analytics.json`
  - `teams.csv`
  - `areas.csv`
  - `sessions.csv`
  - `events.csv`
  - `AI_ANALYSE_PROMPT.md`
- repeated-action comparison:
  - `comparison.json`
  - `actions.csv`
  - `AI_VERGLEICHS_PROMPT.md`
- generated prompts ask for bottlenecks, workload imbalance, problem Areas, which Teams should do less/more next time, trends and concrete improvements;
- comparison produces descriptive deltas, never an opaque Team score/ranking;
- prompts warn when changed territory/task amount makes direct comparison unfair;
- exported labels are treated as untrusted data, not AI instructions;
- CSV neutralizes formula prefixes;
- credentials, GPS trails, comment bodies, free Session notes and account data are excluded from the initial AI package;
- no automatic AI call and no AI authority over assignments/permissions.

ADR-0018 records the proposed Template/version/Action Cycle/export architecture while exact D1 representation remains open.

Initial PR #49 CI #351 passed; later comparison/template UI extensions have their own current final-head check.

## Open product/architecture decisions

1. ADR-0013: confirm application-owned generated Task ids + separate OSM provenance.
2. M6: choose initial persisted continuous multi-way Street geometry representation.
3. Action/history: normal archive vs Organizer-only permanent deletion policy.
4. Organizer: allow multiple Organizers or exactly one effective Organizer at a time.
5. Organizer/Admin: whether selected Admins may be delegated `admin.manage` or only Organizers can add Admins.
6. Template: whether non-secret operational defaults beyond map/Teams/Areas belong in the template.
7. Collection: linked to prior Distribution by default but also independently creatable, or linked-only.
8. Comment edit/delete/moderation/actor semantics before persistence.
9. Live Group credential/group lifetime/rotation and final capability matrix.
10. Admin username canonicalization policy.
11. Secure Worker password-verifier benchmark/runtime path.
12. Recovery codes / catastrophic all-admin recovery policy.
13. Admin session idle/absolute lifetime.
14. Legacy Campaign access-link coexistence/migration.

## Promotion rule

A workbench slice may be considered for stable promotion only after:
- its dependencies are intentionally promoted in order;
- final-head CI is green;
- relevant ADRs are accepted;
- required browser/mobile acceptance is recorded;
- security release gates apply to any security-sensitive subsystem;
- documentation is updated to distinguish shipped behavior from experiments.

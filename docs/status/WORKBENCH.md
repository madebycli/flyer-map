---
id: status-workbench
type: status
status: experimental
last_updated: 2026-08-26
related: [plan-011-offline-map-area, plan-012-platform-app-expansion, ADR-0012]
---

# Unattended Workbench

Experimental non-main work only. Nothing here declares shipped `main` behavior.

## Branch policy

- never merge Workbench changes to `main` automatically;
- keep dependent work isolated on non-main branches/PRs;
- continue already-decided or presentation-only work without inventing unresolved persistence/security behavior;
- record decision points explicitly;
- no Service Worker, installable PWA or Background Sync.

## Prepared offline map

- PR #28: Plan 011 Settings download/update/delete UX, unmerged.
- PR #29: offline prepared OSM MapLibre context plus neutral progress/M6 foundations, unmerged; current head passed CI #447.
- real phone/browser acceptance is still required before Plan 011 completion.

## Smart Streets / Houses

- PR #34: OSM road/building candidates.
- PR #38: start/end selection, route choices, waypoints and point-to-road snapping. Point-snap CI #368 passed.
- PR #39: combined Smart-Street semantics + isolated touch preview, retargeted cleanly to `workbench-m6-candidate-prep`; current head passed CI #416.
- PR #40: House single/multi/same-street selection UI.
- PR #46: proposed ADR-0013 for application-owned Task ids + OSM provenance. Still proposed.

Confirmed interaction:
- street names never define selection extent;
- click/tap snaps to a precise point on prepared road geometry;
- near intersections multiple nearby road candidates may be offered instead of guessing;
- first snapped point is Start, second is Ende;
- unique shortest connected topology selects exact connected sections;
- equal plausible routes are shown for explicit user choice;
- ambiguity UX is C: route choices plus optional intermediate waypoints;
- waypoints can deliberately force an alternate/longer route;
- road list remains keyboard/accessibility fallback;
- isolated preview route is `?workbench=m6`.

Still blocked before M6 persistence:
- explicit acceptance of durable application-owned Task ids + separate OSM provenance;
- persisted geometry representation for clipped/multi-way selected road sections.

## Live Field Groups

- PR #48: local creation + Campaign/action online-group discovery, final head passed CI #434.
- isolated preview route is `?workbench=groups`.
- default list is `Alle in der Aktion`, optional Team filter.
- new groups default `online anzeigen = an`.
- local create draft contains only label, caller-allowed Team id, discoverability and active state.
- preview/local draft contains no Room/QR credential or authority.
- newly created preview groups deliberately have no real join availability until a future server credential exists.
- ADR-0014: valid room code/QR may bootstrap temporary Field-Group/Team-scoped access without prior Campaign access.
- temporary access never becomes Admin/Organizer authority.
- one Field Group represents exactly one tour and normally ends through explicit manual close.
- manual close invalidates future Room-Code/QR joining immediately.
- a still-open group and its temporary join credentials expire no later than 24 hours after original creation; rotation must not extend that hard maximum.
- `expired` is the safety fallback, not the normal lifecycle.
- participant count may be updated during the tour and must be finalized before manual close; it feeds Field Session/person-time/statistics only and never changes permissions.

Still blocked before credential runtime:
- credential rotation/revocation UX within the fixed 24-hour lifetime;
- exact temporary member capability matrix and relationship to existing Campaign sessions;
- rate-limit/revocation/brute-force/expiry tests and configuration;
- minimal audit events without secrets.

## Organizer / Admin / Team roles

- PR #47: documentation-only identity/permission/security proposals; current security-doc head passed CI #446.
- PR #44: presentation-only desktop Admin/Organizer + Team-role + destructive Action workbench; preview head passed CI #423.
- isolated preview route is `?workbench=admin`.

Confirmed defaults:
- multiple Organizers allowed;
- at least one effective Organizer must remain;
- Organizer has Admin-management authority by default;
- Organizer may delegate `admin.manage` to selected Admin role templates;
- delegated Admin never becomes Organizer;
- normal Team Member may edit operational data inside its own Team, including Areas and Tasks;
- optional Team Leader defaults to Team Member rights plus Team name/color, member/invite and live-group management;
- Team Member/Leader rights are represented as configurable known-capability presets in the local Admin preview;
- unknown/cross-Team/Admin capabilities are rejected by the Team-role model;
- all ordinary role defaults remain configurable later through named role templates within delegation ceilings;
- permanent Action deletion is Organizer-only and not delegable;
- normal completed-Action path is archive + retained operational history;
- Workbench hard-delete confirmation phrase is `AKTION LÖSCHEN`;
- UI is never the security boundary.

No account/password/TOTP/permission runtime exists.

## Templates / repeated actions / analytics

PR #49 + ADR-0018 + Plan 013 model:
- **Distribution Template** and **Collection Template** separately;
- Templates can be downloaded/loaded as validated `flyer-map-action-template` JSON files;
- New Action Wizard first chooses Distribution vs Collection and only offers compatible Templates;
- an Action may deliberately start without a Template;
- creating an Action always starts fresh operational ids/state/history;
- normal non-secret defaults such as map view, Team colors and `online anzeigen = an` may live in a Template;
- no old completion/history/groups/comments/credentials are copied;
- Collection Templates have their own car Teams and usually more/smaller Areas; they do not inherit who distributed where;
- optional Action Cycle may group related Distribution and Collection rounds for reporting without sharing assignments/progress;
- repeated-action Admin exports include structured JSON/CSV + AI prompts;
- AI recommendations remain advisory and never control assignments/permissions;
- CSV formula-like values are neutralized;
- AI prompts treat labels as untrusted data;
- secrets/GPS/comment bodies/free Session notes/account details are excluded from initial analysis export;
- isolated `?workbench=actions` preview combines Template import/download and New Action creation with separate fake Distribution/Collection planning;
- current Action preview head `de331c17d855780931fbf511e23cc7e79fe83c82` passed CI #445.
- keep the regression test that rejects/drops unknown nested Template Team/Area/Road fields; normalization must copy allowlisted fields explicitly rather than preserving object-spread extras.

## History

ADR-0017 direction:
- meaningful operational history retained;
- no ordinary age-based expiry;
- exact old geometry reconstruction not required for v1 reflection;
- current/reviewed Task references plus retained events/sessions support retrospective analysis;
- archive is normal completed-Action lifecycle.

Permanent deletion storage/cascade semantics remain blocked until Action/history persistence is designed and accepted.

## Other prepared Workbench slices

- PR #30 app-menu model, support diagnostics, Field Session metrics.
- PR #31 expanded Team palette.
- PR #32 reusable app/progress/Team/support UI.
- PR #35 local System/Light/Dark.
- PR #36 Campaign/Team/Area progress overview.
- PR #37 isolated `?workbench=ui` preview.
- PR #41 independent Pickup model/UI.
- PR #42 comments UI.
- PR #43 Field Session draft/history UI.
- PR #45 compact mobile field chrome.

## Handoff

Full current copy/paste context for a new ChatGPT conversation is stored in:
- `docs/prompts/CONTINUE_WORKBENCH_LATEST.md`

That prompt must be updated when confirmed product architecture or major Workbench topology changes materially.

## Major open architecture/product decisions

1. ADR-0013 final durable Smart Street/House identity + persisted selected geometry.
2. Live Group credential rotation/revocation, temporary capability/session relationship, rate-limit and audit details. The manual-close + hard 24-hour lifetime is already confirmed.
3. Identity/TOTP/session/recovery details under ADR-0015.
4. Final role-template update/version and access-link migration details under ADR-0016.
5. Template/Action/Cycle D1 representation and template-version UX under ADR-0018.
6. Whether Collection Actions may exist completely outside an Action Cycle or cycles remain optional grouping only.
7. Comment moderation/edit/delete semantics.
8. Legacy Campaign access-link coexistence/migration.

## Promotion rule

A slice is considered for stable promotion only after dependencies are promoted intentionally, final-head CI is green, relevant ADRs are accepted, required browser/mobile acceptance is recorded, security gates pass where applicable, and shipped-vs-experimental docs are updated.

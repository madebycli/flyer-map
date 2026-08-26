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
- keep dependent work stacked on non-main branches;
- continue already-decided/presentation-only work without inventing unresolved persistence/security behavior;
- record decision points explicitly;
- no Service Worker, installable PWA or Background Sync.

## Prepared offline map

- PR #28: Plan 011 Settings download/update/delete UX, unmerged.
- PR #29: offline prepared OSM MapLibre context plus neutral progress/M6 foundations, unmerged.
- real phone/browser acceptance still required before Plan 011 completion.

## Smart Streets / Houses

- PR #34: OSM road/building candidates.
- PR #38: start/end selection, route choices, waypoints and point-to-road snapping. Latest point-snap head CI #368 passed.
- PR #39: isolated route/waypoint preview, stacked on PR #38.
- PR #40: House single/multi/same-street selection UI.
- PR #46: proposed ADR-0013 for application-owned Task ids + OSM provenance. Still proposed.

Confirmed interaction:
- street names never define extent;
- start/end can be detailed road-line anchors;
- unique path selects exact connected section;
- equal plausible paths are shown for explicit user choice;
- intermediate waypoints allow precise correction/intentional detours;
- click snapping near intersections may return multiple nearby road candidates instead of guessing.

Still blocked before M6 persistence:
- explicit acceptance of durable application-owned Task ids + separate OSM provenance;
- persisted geometry representation for clipped/multi-way selected road sections.

## Live Field Groups

- PR #48: Campaign/action online group list, default `Alle in der Aktion`, Team filter, new groups default `online anzeigen = an`.
- ADR-0014: valid room code/QR may bootstrap temporary Field-Group/Team-scoped access without prior Campaign access.
- temporary access never becomes Admin/Organizer authority.

Still blocked before credential runtime:
- credential/group lifetime and rotation;
- exact temporary member capability matrix;
- rate-limit/revocation tests/config.

## Organizer / Admin / Team roles

- PR #47: documentation-only identity/permission/security proposals.
- PR #44: presentation-only desktop Admin/Organizer UI plus Organizer-only destructive Action confirmation guard.

Confirmed:
- multiple Organizers allowed;
- at least one effective Organizer must remain;
- Organizer has Admin-management authority by default;
- Organizer may delegate `admin.manage` to selected Admin roles;
- delegated Admin never becomes Organizer;
- normal Team members can edit operational Areas/Tasks inside their own Team;
- optional Team Leader may add Team-management responsibilities;
- permanent Action deletion is Organizer-only;
- normal path is archive + retain operational history;
- Workbench hard-delete confirmation phrase is `AKTION LÖSCHEN`;
- UI is never the security boundary.

Open Team-role detail:
- exact extra Team Leader rights, especially Team name/color, member/invite and live-group management.

No account/password/TOTP/permission runtime exists.

## Templates / repeated actions / analytics

PR #49 + ADR-0018 + Plan 013 now model:
- **Distribution Template** and **Collection Template** separately;
- Templates can be downloaded/loaded as validated `flyer-map-action-template` JSON files;
- creating an Action selects a compatible Template and starts fresh operational state;
- normal non-secret defaults such as map view, Team colors and `online anzeigen = an` may live in a Template;
- no old completion/history/groups/comments/credentials are copied;
- Collection Templates have their own car Teams and often more/smaller Areas instead of inheriting Distribution assignments;
- optional Action Cycle can group related Distribution and Collection rounds for reporting without sharing progress;
- repeated-action Admin exports include structured JSON/CSV + AI prompts;
- AI recommendations remain advisory and never control assignments/permissions;
- CSV formula-like values are neutralized;
- AI prompts treat labels as untrusted data;
- secrets/GPS/comment bodies/free Session notes/account details are excluded from initial analysis export.

Latest template import/export + mode separation head CI #379 passed.

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

## Major open architecture/product decisions

1. ADR-0013 final durable Smart Street/House identity + persisted selected geometry.
2. Exact Team Leader extra rights.
3. Live Group credential lifetime/rotation/member capability matrix.
4. Identity/TOTP/session/recovery details under ADR-0015.
5. Final role-template version/delegation details under ADR-0016.
6. Template/Action/Cycle D1 representation and template-version UX under ADR-0018.
7. Whether Collection Actions may exist completely outside an Action Cycle.
8. Comment moderation/edit/delete semantics.
9. Legacy Campaign access-link coexistence/migration.

## Promotion rule

A slice is considered for stable promotion only after dependencies are promoted intentionally, final-head CI is green, relevant ADRs are accepted, required browser/mobile acceptance is recorded, security gates pass where applicable, and shipped-vs-experimental docs are updated.

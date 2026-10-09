---
id: plan-012-platform-app-expansion
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, product-ux, architecture-map, architecture-offline-sync, architecture-collaboration, architecture-organizations, architecture-identity-permissions, architecture-live-teams, architecture-security, quality]
---

# Plan 012 — Full Platform / App Expansion

## Goal

Evolve Verteil-Flyer from a shared flyer-distribution map into a secure, app-like field and administration platform for flyer distribution, live field groups, progress/statistics, later clothes collection, multiple organizations, configurable permissions and multiple administrators.

This is an umbrella plan. It defines product direction, architecture boundaries and sequencing. It does not mean all capabilities are already implemented.

## Baseline / source of truth

Before implementing any slice from this plan, read:
1. `AGENTS.md`;
2. `docs/status/CURRENT.md`;
3. `docs/context-map.yaml`;
4. `docs/product/ROADMAP.md`;
5. only the graph nodes relevant to the chosen slice;
6. relevant accepted ADRs;
7. current `main`, open PRs and CI.

Current constraints remain until explicitly superseded:
- normal mobile-first website;
- no native app;
- no installable PWA;
- no Service Worker / Background Sync;
- MapLibre GL JS 5.7.1 remains the accepted renderer baseline;
- Worker-side authorization is authoritative;
- ids are selectors, never credentials;
- no continuous GPS route surveillance.

M5 is already being implemented in Draft PR #24 on `m5-resilient-sync-mainline`. Do not create a second M5 implementation branch.

## Product vocabulary

### Organization
Top-level tenant/workspace. Owns Campaigns and administrator accounts.

### Campaign / Aktion
One concrete distribution/collection campaign.

### Team
Persistent colored Campaign group. This is the current colored group concept.

A Team has:
- name;
- color;
- Areas;
- Team-specific access/invite policy;
- optional date;
- progress/statistics and Field Session history.

### Field Group / Einsatzgruppe
Temporary group of people/devices currently working together inside one Team.

This is not the same as Team. It can be joined from multiple devices and may optionally be discoverable to other authorized Campaign participants.

### Field Session / Einsatz
One concrete outing/work session of a Team or Field Group.

Session data may include:
- date;
- duration or start/end time;
- participant count;
- optional note;
- completed/changed Task ids;
- person-time (`duration × participants`);
- summary counts.

### Distribution Task
Street/House/etc. unit for flyer distribution.

### Pickup Task
Separate later collection unit. Distribution and pickup completion must never overwrite each other.

## Mobile information architecture

The field website should feel app-like while remaining a normal website.

### Map remains home
The map stays the default field workspace.

### Bottom bar redesign
Target direction:
- Settings becomes a small icon-only gear action;
- Teams receives a familiar people/team/contact icon;
- Teams sits in the right-side action cluster;
- a Menu/App button is added on the right;
- remove oversized text actions where an accessible icon is clearer;
- icon-only controls always have localized accessible labels/tooltips.

### Full-screen app menu
The Menu button opens a full-screen mobile surface similar to an app launcher/dashboard.

Candidate modules:
- Progress;
- Teams / Join Team;
- Activity / Comments;
- Collection mode;
- Support / Feedback;
- Settings;
- Admin entry when authorized.

Open/close may use a short transition/animation, but must respect `prefers-reduced-motion` and should not add an animation library without evidence.

### Active Team context
When currently working in a Team/Field Group:
- Team name is shown compactly in the top bar near the Menu button;
- old always-visible Team dropdown is removed;
- a small unobtrusive progress bar is visible in/under the top bar;
- tapping Team context opens details rather than accidentally changing Team.

## Statistics and progress

### Core progress
Show a clear percentage and progress bar for:
- Campaign;
- Team;
- Area;
- optionally current Field Session.

Examples:
- `62 % fertig`;
- completed / total Streets;
- completed / total Houses when House Mode exists;
- remaining items.

The denominator must be explicit. Do not mix Streets and Houses into a misleading percentage without a defined aggregation rule.

### Field-session history
Below the primary progress summary, show how often the Team has been out and what it accomplished.

Each session may show:
- date;
- duration;
- number of people;
- optional note;
- Team / Field Group;
- changed/completed Task count;
- calculated person-time.

### Map highlighting
Selecting a past Field Session highlights the Streets/Houses changed or completed during that session.

Do not infer this from GPS traces. Derive it from domain activity/events and Task ids associated with the session.

### Area sizing
Statistics should help coordinators answer:
- Was this Area realistically sized?
- How many outings were required?
- How much person-time was needed?
- Which sections remain?

This is operational planning, not worker surveillance.

## Team creation and management

Team creation should support:
- name;
- color;
- optional date;
- live-group discoverability default/policy;
- Team-specific invite/access policy.

### Color palette
Keep convenient presets but expand the palette.

First visible preset order:
1. Orange;
2. Blue;
3. Green;
4. Red;
5. Gray.

Additional accessible colors follow. Color is never the only status signal.

### Team deletion / archive
Team deletion is a missing capability and must be added safely.

Before implementation define:
- what happens to Areas, Tasks, sessions, comments and access grants;
- whether history is preserved through archive/soft-delete;
- explicit destructive confirmation;
- server-side permission checks;
- protection against orphaned references.

Prefer archive/soft-delete when statistics/audit history must remain.

## Live Teams / multi-device joining

A Field Group can be discoverable to other authorized Campaign participants.

Target behavior:
- discoverability is enabled by default when a Field Group is created, with explicit opt-out;
- discoverability is never public internet discovery;
- only authorized Campaign participants can browse live groups;
- multiple devices can join the same active Field Group;
- join mechanisms may include QR code, human-enterable code and optional join password;
- active group shows Team identity/color/current progress context;
- group members can collaborate without receiving administrator access.

Persistent Team invites and temporary Field Group join credentials are separate concepts.

Current generic invite-link UI must later be redesigned so:
- each persistent Team has its own managed access/invite entries;
- temporary Field Group codes/QRs are short-lived join mechanisms;
- temporary group membership never silently grants persistent Team/Admin access.

See `docs/architecture/LIVE_TEAMS.md`.

## Clothes collection / pickup mode

After flyer distribution, the same map should support collection with cars.

Requirements:
- separate Distribution and Collection modes;
- reuse M6 real Street/House geometry where possible;
- mark road/collection sections as driven/finished;
- create explicit pickup addresses/House Tasks;
- manually add addresses from phone calls/reports;
- track open / collected / unavailable / needs-follow-up independently from flyer status;
- support Field Groups in collection mode;
- keep collection progress/statistics separate from distribution progress.

## Desktop Admin panel

Admin is a separate desktop-first surface, not a giant field-map sheet.

Target modules:
- Organizations;
- Campaigns;
- Teams;
- Team archive/delete;
- Team colors/metadata;
- Areas/ownership;
- member/access overview;
- invite management;
- permissions;
- live-group policy;
- statistics/session history;
- comments/activity/audit;
- support/feedback;
- security/account management.

The field map must stay lightweight even as Admin grows.

## Configurable permissions

Administrators need more control than the current fixed `Admin / Team Editor / Viewer` matrix.

Candidate capability keys:
- `team.create`;
- `team.rename`;
- `team.change-color`;
- `team.archive-or-delete`;
- `area.create`;
- `area.edit-own-team`;
- `area.edit-other-team`;
- `area.delete`;
- `task.edit-own-team`;
- `task.edit-other-team`;
- `task.delete`;
- `invite.manage-own-team`;
- `invite.manage-other-team`;
- `live-group.create`;
- `live-group.manage`;
- `live-group.discoverability`;
- `comment.create`;
- `comment.moderate`;
- `statistics.view`;
- `campaign.settings`;
- `permission.manage`;
- `admin.manage`.

Rules:
- deny by default when capability is absent;
- enforce capabilities server-side;
- UI toggles only reflect effective permissions;
- permission/role changes create audit events;
- no capability can bypass Organization tenant boundaries.

Exact role-template/override semantics require an ADR. See `docs/architecture/IDENTITY_PERMISSIONS.md`.

## Administrator accounts, transfer and 2FA

The future Organization/Admin system must support multiple administrator accounts and safe admin handover.

Requested login model:
- username;
- password;
- authenticator-app TOTP as 2FA;
- no SMS 2FA requirement;
- email not required as identity.

Security is release-blocking for this subsystem.

Mandatory properties:
- never concatenate username/password/form input into SQL;
- D1 access uses parameterized/prepared queries;
- raw passwords are never stored or logged;
- use a reviewed password-hashing design with unique salts and appropriate work/memory cost for the selected runtime/library;
- TOTP secrets are protected at rest and never logged;
- login creates/rotates opaque server-revocable sessions;
- secure cookie protections remain mandatory;
- login/TOTP endpoints are rate-limited;
- TOTP validation is server-side with narrow clock tolerance and replay handling where feasible;
- CSRF/Origin protections apply to authenticated writes;
- restrictive CSP/output encoding reduce XSS risk;
- SQL/HTML/JS/code-like text entered into username/password/form fields remains inert data and never executes;
- authentication never replaces authorization checks;
- last effective Organization Admin cannot be accidentally removed without safe transfer/recovery;
- security/admin/permission changes create audit events.

A dedicated accepted ADR and threat-model review are mandatory before implementation.

## Support and feedback

Add a Support / Feedback module accessible from the full-screen menu.

Initial scope:
- help/FAQ;
- app/version/environment info useful for support;
- feedback/bug-report form;
- optional Campaign/Area context only when authorized and clearly disclosed;
- never auto-attach secrets, access tokens, TOTP secrets, exact GPS history or private exports.

## Candidate future data entities

Names are provisional and require per-slice review.

Possible entities:
- organizations;
- accounts;
- organization_memberships;
- role_templates / permission_policies;
- account_sessions;
- account_totp_credentials;
- field_groups;
- field_group_memberships;
- field_group_join_credentials;
- field_sessions;
- field_session_task_events;
- activity_events;
- comments;
- pickup_tasks;
- support_feedback;
- statistics rollups only when real scale requires them.

Do not add all tables at once. Use additive D1 migrations only for the active slice.

## Implementation sequence

### Phase 1 — finish M5 resilient synchronization
- complete PR #24 gates;
- merge M5 cleanly;
- preserve current renderer/access security.

### Phase 2 — M5.5 prepared offline working area
- execute Plan 011 once available on merged baseline;
- decide offline-permitted map source/format through ADR;
- strict cold offline app-shell loading remains a separate architecture decision.

### Phase 3 — M6 Smart Street + House geometry
- real road selection/generation;
- House Mode;
- stable Street/House identities needed by sessions, pickup and statistics.

### Phase 4 — M6.5 Collection / Pickup
- separate pickup domain state;
- call-in/manual pickup addresses;
- driven/collected progress;
- reuse Street/House geometry.

### Phase 5 — M7 Field Sessions + Live Groups + Collaboration
- field session model;
- duration + participant count + optional note;
- append-only Task/session activity;
- comments;
- live Field Groups, multiple devices, QR/code/password joining;
- Team-specific invites;
- session map highlighting;
- initial compact Team/Area progress.

### Phase 6 — M8 Identity + Organizations + Permissions + Admin
- accepted identity/permission ADR first;
- username/password/TOTP admin accounts;
- multiple Organization Admins and safe transfer;
- tenant model;
- capability matrix;
- Team delete/archive;
- desktop Admin panel;
- account/security/audit UI.

### Phase 7 — M9 Statistics + app shell + support + appearance
- Campaign/Team/Area progress dashboards;
- session/outings count;
- duration/person counts/person-time;
- session history map highlighting;
- full-screen app menu and compact field chrome;
- Support/Feedback;
- system/light/dark UI.

### Phase 8 — M10 security / field hardening / release
- security review of account/auth/permission flows;
- injection/XSS/CSRF/session/TOTP tests;
- tenant-isolation tests;
- QR/code brute-force tests;
- mobile/desktop usability;
- dense Street/House/session datasets;
- outdoor connectivity;
- accessibility/reduced-motion;
- production recovery/runbooks.

## Required ADRs

Before expensive implementation, at minimum:
1. offline map source/provider/package ADR;
2. Organization identity + username/password/TOTP + account-session ADR;
3. permission/capability + role-template ADR;
4. live Field Group join/discoverability/credential ADR;
5. Street/House identity/splitting ADR if not already decided by M6;
6. event/session/statistics retention ADR before long-term analytics storage.

## Acceptance criteria

The expanded platform is only accepted when delivered slices prove:
- progress percentages reconcile with source Tasks/events;
- Team/Area/Campaign progress is understandable on mobile;
- session history shows date, duration, people and work performed;
- selecting a session highlights its affected geometry;
- Teams can be archived/deleted according to defined retention semantics;
- permission toggles are enforced by Worker tests, not only UI;
- Organizations are isolated from each other;
- multiple admins exist and admin authority can be transferred safely;
- admin login requires password + TOTP according to accepted policy;
- injection-like input remains inert data;
- live Field Groups can be joined from multiple devices via authorized QR/code flow;
- live discoverability can be disabled and is not public internet discovery;
- Team invites remain distinct from temporary Field Group credentials;
- pickup progress is independent from distribution progress;
- field UI remains map-first and performant;
- desktop Admin does not bloat the normal field experience;
- no feature introduces continuous GPS surveillance.

## Risks

- overly flexible permissions can become hard to reason about;
- join codes/passwords can become weak credentials if too short or long-lived;
- account security is much more sensitive than current access links;
- statistics can mislead if denominator/aggregation rules are undefined;
- deleting Teams can destroy history without deliberate retention semantics;
- app-menu/admin growth can increase bundle size and field load time;
- presence/live-group features can become privacy-invasive if GPS/device identity is over-collected;
- confusing persistent Teams with temporary Field Groups would corrupt permissions and invites.

## Explicit non-goals

Unless an accepted ADR changes them:
- no native mobile app;
- no hidden continuous GPS route logging;
- no SMS 2FA;
- no client-only authorization;
- no SQL built through string concatenation of user input;
- no public internet list of active field groups;
- no single shared admin password;
- no automatic promotion of Field Group member to Team/Admin access;
- no mixing distribution completion with collection completion;
- no giant all-at-once database migration.

## Documentation discipline

Every implementation slice must:
- use `docs/context-map.yaml` to load context;
- create an ADR for expensive/reversible-sensitive decisions;
- use additive D1 migrations;
- update `CURRENT.md` and relevant architecture/product docs;
- keep secrets/private Campaign data out of GitHub and chat;
- keep completed plans out of `active/` once finished.

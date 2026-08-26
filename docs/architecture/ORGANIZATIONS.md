---
id: architecture-organizations
type: architecture
status: proposed
last_updated: 2026-08-26
related: [product-roadmap, architecture-security, architecture-data, architecture-identity-permissions, architecture-live-teams, plan-012-platform-app-expansion]
source_of_truth_for: [future-organization-model, future-admin-panel-boundary, future-organizer-admin-hierarchy]
---

# Organizations and Admin Platform — Proposed

## Purpose

Define constraints for the future multi-organization and Admin platform. This is not implemented and does not change current Campaign authorization by itself.

## Target hierarchy

```text
Organization
  ├─ Organizer accounts (one or more, at least one effective)
  ├─ Admin/member accounts
  ├─ Permission policies / role templates
  ├─ Distribution Templates
  ├─ Collection Templates
  ├─ Aktionen / Campaigns
  │   ├─ Teams
  │   │   ├─ Team Members
  │   │   ├─ optional Team Leader
  │   │   ├─ Areas
  │   │   ├─ Field Groups / Field Sessions
  │   │   └─ Team-specific access
  │   ├─ Distribution Tasks or Collection/Pickup work
  │   └─ retained operational history
  └─ Organization settings / audit / analytics exports
```

Organization is the absolute tenant boundary.

## Organizer

Confirmed product direction:
- multiple Organizers are allowed;
- at least one effective Organizer must always remain;
- Organizer can add/promote/disable normal Admins;
- Organizer has `admin.manage` by default;
- Organizer may delegate `admin.manage` to selected Admin role templates;
- Organizer manages Organization-wide permission/role policy;
- Organizer may manage templates and Organization-wide settings;
- only Organizer may permanently delete an Aktion in the current direction;
- Organizer authority/actions are audited;
- Organizer never crosses Organization boundary.

Organizer-management itself remains stricter than ordinary Admin management and requires accepted identity/re-authentication/recovery policy.

## Admin

Admins handle operational administration according to explicit capabilities.

Possible responsibilities:
- create/archive Aktionen;
- manage Templates when allowed;
- manage Teams/Areas/Tasks;
- manage Field Groups and Campaign settings;
- view statistics/history;
- create Admin analytics/log exports;
- review Campaign/Team access;
- manage other normal Admins only when an Organizer explicitly delegated `admin.manage`.

Delegated Admin management never grants Organizer status or `organizer.manage`.

## Team Member and Team Leader

Confirmed default direction:
- a normal member of a Team can edit operational data belonging to that Team, including Areas and Tasks;
- own-Team authority is resolved server-side from canonical membership/resource relations;
- a Team member cannot edit another Team by changing a request id.

Optional Team Leader:
- useful when an Organization wants one designated Team coordinator;
- includes normal own-Team editing;
- may additionally manage Team metadata, Team membership/invites and live Field Groups according to the final accepted capability set;
- exact extra Team Leader capabilities remain configurable/reviewable and are not required for ordinary Team editing.

## Action archive and permanent deletion

Normal lifecycle:
- completed Aktionen are archived;
- retained operational history/statistics remain available.

Permanent deletion:
- Organizer-only in current product direction;
- normal Admin/Team roles cannot receive it through custom capability delegation;
- Admin UI must clearly identify the Aktion and require deliberate destructive confirmation;
- current Workbench confirmation phrase is `AKTION LÖSCHEN`;
- Worker must re-check Organizer authority server-side and audit the event;
- exact D1 cascade/retention semantics require accepted Action/history persistence ADRs.

## Authority handover

Organizer/Admin access is transferable without sharing passwords or TOTP secrets.

Safety requirements:
- transactional last-effective-Organizer protection;
- promotion/removal audited;
- safe recovery without first-visitor/race-to-claim behavior;
- disabled/revoked account loses authority promptly;
- Admin cannot self-promote to Organizer;
- delegated `admin.manage` cannot create Organizer authority.

## Identity

Requested future account model:
- username;
- password;
- authenticator-app TOTP;
- no SMS requirement;
- no mandatory email identity.

Runtime implementation is blocked on accepted identity/session ADR and threat model.

## Permission model

Current fixed Campaign roles are insufficient.

Future capability families include:
- Team create/rename/color/archive/member management;
- Area/Task own-Team vs other-Team edits;
- Team invites;
- live Field Group create/manage/discoverability;
- statistics/history;
- analytics export;
- Aktion/template settings;
- permission management;
- Admin management;
- Organizer management under stricter policy.

Rules:
- deny by default;
- Worker evaluates effective capability on every protected operation;
- UI reflects but never grants authority;
- Organization boundary is non-overridable;
- permission changes are audited.

## Templates and repeated actions

Organization owns reusable Distribution and Collection Templates.

Confirmed direction:
- Templates are mode-specific;
- may be downloaded/loaded through validated portable files;
- contain non-secret operational planning/defaults;
- never contain old completion/history/credentials;
- Collection Templates may use completely different car Teams and smaller Areas than Distribution Templates.

See ADR-0018 / Plan 013 for details.

## Team archive/delete

Team removal must preserve understandable history.

Before runtime define:
- archive vs hard delete;
- Areas/Tasks/session/comment references;
- access grants;
- restore behavior;
- scoped credentials after Team removal.

Prefer archive/tombstone where history exists.

## Admin panel boundary

Admin is desktop-first and separate from the field map.

Admin surface includes:
- Organizations;
- Organizers/Admins;
- Distribution/Collection Templates;
- Aktionen and archive/delete;
- Teams/Areas/ownership;
- access/invites;
- permissions;
- live-group policy;
- statistics/Field Sessions;
- activity/audit;
- AI-analysis/log export;
- support/security/account management.

Field map remains map-first and lightweight.

## Security requirements

Mandatory:
- tenant scope enforced by Worker/D1 query boundaries;
- no cross-Organization data/export access;
- authentication never replaces authorization;
- ids are selectors, not credentials;
- all D1 queries prepared/parameterized;
- sensitive management/export/delete actions audited;
- recovery never creates anonymous ownership;
- secrets never enter analytics/template exports.

## Current Campaign-role migration

Current Admin / Team Editor / Viewer roles remain until an explicit migration.

Do not silently reinterpret current Campaign Admin as Organization Admin/Organizer. Legacy access-link sessions remain separate from account-based authority until a reviewed migration/coexistence slice.

## Remaining decisions

- exact Team Leader additional rights;
- whether delegated `admin.manage` Admin can create new account identities directly or only manage existing/onboarded Admin accounts;
- account/TOTP/session/recovery details;
- role-template update/delegation rules;
- legacy Campaign access migration;
- Organization deletion/export/audit retention;
- final Action/Template/Cycle D1 representation.

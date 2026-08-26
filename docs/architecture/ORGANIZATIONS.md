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

Define constraints for the future multi-organization and Admin platform.

This is not yet implemented and does not change current Campaign authorization by itself.

## Target hierarchy

```text
Organization
  ├─ Organizer account(s)
  ├─ Admin/member accounts
  ├─ Permission policies / role templates
  ├─ Campaign templates
  ├─ Campaigns / Aktionen
  │   ├─ Teams
  │   │   ├─ Areas
  │   │   ├─ Field Groups / Field Sessions
  │   │   └─ Team-specific invites/access
  │   ├─ Distribution Tasks
  │   └─ Pickup Tasks
  └─ Organization settings / audit / operational overview / exports
```

Organization is the tenant boundary. Campaigns belong to exactly one Organization after migration.

## Organizer and Admin

The product hierarchy distinguishes a top-level **Organizer** from normal **Admins**.

### Organizer

Organizer is responsible for administrative authority itself.

Confirmed direction:
- Organizer can add/promote/disable Admin accounts according to the accepted identity/re-authentication policy;
- Organizer manages Organization-wide permission/role policy;
- Organizer can manage Campaign templates and Organization-wide configuration;
- Organizer is protected by a last-effective-Organizer invariant;
- Organizer actions are audited;
- Organizer authority never crosses the Organization tenant boundary.

### Admin

Admins handle normal operational administration according to their capabilities.

Typical responsibilities may include:
- create/archive Campaigns when allowed;
- manage Teams/Areas/Tasks;
- manage Field Groups and Campaign settings;
- view statistics/session history;
- create Admin-only analytics/log exports;
- review Campaign/Team access.

Normal Admins do not automatically gain Organizer authority or the right to create new Organizers. Whether selected Admins may be delegated Admin-management authority remains an ADR decision.

## Authority handover

Organizer/Admin access must be transferable without sharing passwords or TOTP secrets.

Safety requirements:
- do not accidentally remove the last effective Organizer;
- Organizer/Admin promotion/removal is audited;
- safe recovery exists without first-visitor/race-to-claim behavior;
- a disabled/revoked account loses server-side authority promptly;
- a normal Admin cannot self-promote to Organizer merely through UI or client-controlled role values.

## Administrator identity

Requested future account model:
- username;
- password;
- authenticator-app TOTP;
- no SMS requirement;
- no mandatory email identity.

The full security design is governed by `docs/architecture/IDENTITY_PERMISSIONS.md` and the proposed ADRs 0015/0016. It requires accepted security decisions before runtime implementation.

## Permission model

Current fixed Campaign roles are not enough for the requested Admin settings.

Future capabilities include:
- Team create/rename/color/archive-delete;
- Area/Task edits across own/other Teams;
- Team invites;
- live Field Group create/manage/discoverability;
- statistics/history viewing;
- analytics/log export;
- Campaign/template settings;
- permission management;
- Admin management;
- Organizer management under stricter policy.

Rules:
- deny by default;
- Worker evaluates effective capability on every protected action;
- UI reflects but never grants authority;
- Organization boundary cannot be overridden by permission configuration;
- permission changes are audited.

Exact role-template/delegation semantics require ADR-0016 acceptance.

## Team archive/delete

Team deletion is explicitly required but must not destroy history accidentally.

Before implementation define:
- archive vs hard delete;
- handling of Areas/Tasks;
- Field Sessions/activity/comments;
- invites/access grants;
- statistics/history;
- restore behavior;
- scoped credentials after Team removal.

Preferred direction is archive/tombstone for normal administration, with hard delete only where explicitly safe/required.

## Admin panel boundary

Admin is a separate desktop-first administrative surface.

Field map:
- map-first;
- compact controls;
- Team/Field Group work;
- Task updates;
- progress context.

Admin panel:
- Organizations;
- Organizer/Admin accounts;
- Campaign templates and Aktionen;
- Teams and archive/delete;
- Areas/ownership;
- access and invites;
- permission settings;
- live-group policies;
- statistics/Field Sessions;
- activity/audit;
- AI-analysis/log export;
- support/feedback;
- security/accounts.

Admin must remain responsive, but desktop may use denser tables/forms than field UI.

## Security requirements

Mandatory:
- tenant scope enforced by Worker/D1 query boundaries;
- no cross-Organization reads/writes/statistics/comments/activity/exports;
- account authentication never replaces resource authorization;
- ids are selectors, never credentials;
- parameterized/prepared D1 queries for user-controlled input;
- sensitive management/export actions create audit records;
- recovery never creates anonymous ownership;
- exports never contain passwords, TOTP secrets/codes, session/access secrets or raw credentials.

## Relationship to current Campaign roles

Current roles remain until an explicit migration:
- Admin;
- Team Editor;
- Viewer.

Do not silently reinterpret current Campaign Admin as Organization Admin or Organizer.

The future model may preserve lightweight Campaign/Team access for field participants while Organizer/Admin users use accounts.

## Legacy migration

Existing Campaigns must not disappear.

Migration plan must:
- create/associate Organization container safely;
- preserve Campaign ids, geometry, revisions, grants and history where practical;
- avoid first-visitor claim races;
- use additive D1 migrations;
- define how current Admin grants coexist with/migrate to account-based Organizer/Admin authority.

## Open decisions requiring ADR

- whether multiple Organizers are allowed/recommended;
- whether selected Admins may add other Admins or only Organizers can;
- account schema/password hashing/TOTP recovery;
- role template/delegation rules;
- legacy Campaign Admin migration;
- Organization deletion/export/retention;
- audit retention;
- whether field access links remain independent from administrator login.

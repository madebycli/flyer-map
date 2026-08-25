---
id: architecture-organizations
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-security, architecture-data, architecture-identity-permissions, architecture-live-teams, plan-012-platform-app-expansion]
source_of_truth_for: [future-organization-model, future-admin-panel-boundary, future-multi-admin]
---

# Organizations and Admin Platform — Proposed

## Purpose

Define constraints for the future multi-organization and Admin platform.

This is not yet implemented and does not change current Campaign authorization by itself.

## Target hierarchy

```text
Organization
  ├─ Administrator/member accounts
  ├─ Permission policies / role templates
  ├─ Campaigns
  │   ├─ Teams
  │   │   ├─ Areas
  │   │   ├─ Field Groups / Field Sessions
  │   │   └─ Team-specific invites/access
  │   ├─ Distribution Tasks
  │   └─ Pickup Tasks
  └─ Organization settings / audit / operational overview
```

Organization is the tenant boundary. Campaigns belong to exactly one Organization after migration.

## Multiple administrators

More than one authorized Organization Admin is mandatory.

No design may assume one original creator is the only durable owner.

Administrator capabilities may include:
- create/archive Campaigns;
- manage Organization settings;
- invite/create/disable administrators according to accepted identity policy;
- manage permissions;
- manage Team archive/delete;
- review Campaign/Team access;
- view Organization-wide statistics/activity;
- manage security/recovery according to policy.

## Admin handover

Admin access must be transferable without sharing passwords or TOTP secrets.

Safety requirements:
- do not accidentally remove the last effective Organization Admin;
- admin promotion/removal is audited;
- safe recovery exists without first-visitor/race-to-claim behavior;
- a disabled/revoked account loses server-side authority promptly.

## Administrator identity

Requested future account model:
- username;
- password;
- authenticator-app TOTP;
- no SMS requirement;
- no mandatory email identity.

The full security design is governed by `docs/architecture/IDENTITY_PERMISSIONS.md` and requires an accepted ADR before implementation.

## Permission model

Current fixed Campaign roles are not enough for the requested Admin settings.

Future Admin must be able to configure capabilities such as:
- whether users can create Teams;
- rename/change Team color;
- archive/delete Teams;
- create/edit/delete Areas;
- edit own-Team vs other-Team Areas;
- edit/delete own-Team vs other-Team Streets/Houses/Pickup Tasks;
- manage Team invites;
- create/manage live Field Groups;
- control live-group discoverability policy;
- view statistics;
- manage comments/moderation where applicable;
- change Campaign settings;
- manage permissions;
- manage administrators.

Rules:
- deny by default;
- Worker evaluates effective capability on every protected action;
- UI reflects but never grants authority;
- Organization boundary cannot be overridden by permission configuration;
- permission changes are audited.

Exact role-template/override semantics require ADR.

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
- Campaigns;
- Teams and archive/delete;
- Team colors/metadata/date;
- Areas/ownership;
- access and invites;
- permission settings;
- live-group policies;
- statistics/Field Sessions;
- comments/activity/audit;
- support/feedback;
- accounts/security.

Admin must remain responsive, but desktop may use denser tables/forms than field UI.

## Security requirements

Mandatory:
- tenant scope enforced by Worker/D1 query boundaries;
- no cross-Organization reads/writes/statistics/comments/activity;
- account authentication never replaces resource authorization;
- ids are selectors, never credentials;
- parameterized/prepared D1 queries for user-controlled input;
- sensitive management actions create audit records;
- recovery never creates anonymous ownership.

## Relationship to current Campaign roles

Current roles remain until an explicit migration:
- Admin;
- Team Editor;
- Viewer.

Do not silently reinterpret current Campaign Admin as Organization Admin.

The future model may preserve lightweight Campaign/Team access for field participants while Organization administrators use accounts.

This boundary must be defined in ADR before migration.

## Legacy migration

Existing Campaigns must not disappear.

Migration plan must:
- create/associate Organization container safely;
- preserve Campaign ids, geometry, revisions, grants and history where practical;
- avoid first-visitor claim races;
- use additive D1 migrations;
- define how current Admin grants coexist with/migrate to account-based admin authority.

## Open decisions requiring ADR

- account schema and password hashing;
- TOTP secret protection and recovery;
- account-session model;
- invitation/onboarding for additional admins;
- role templates/capability overrides;
- legacy Campaign Admin migration;
- Organization deletion/export/retention;
- audit retention;
- whether field access links remain independent from administrator login.

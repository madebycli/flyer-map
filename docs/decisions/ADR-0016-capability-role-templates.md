---
id: ADR-0016
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0016: Organization/Campaign capability model and role templates

## Status

Proposed only. Product hierarchy and default role behavior were clarified on 2026-08-26, but no permission tables/runtime are authorized until ADR-0015 identity/session boundaries and this ADR are explicitly accepted.

## Confirmed product hierarchy

### Organizer

Top Organization authority for normal product administration.

Confirmed:
- multiple Organizers are allowed;
- at least one effective Organizer must always remain;
- Organizer has Admin-management authority by default;
- Organizer may add/promote/disable normal Admins;
- Organizer may explicitly delegate `admin.manage` to selected Admin roles;
- delegated `admin.manage` never grants `organizer.manage` or Organizer status;
- only Organizer can manage Organizer membership under the final strong re-authentication policy;
- permanent Action deletion is Organizer-only.

### Admin

Broad operational Organization/Campaign administrator.

An Admin:
- may receive normal operational/admin capabilities;
- may receive delegated `admin.manage` from Organizer policy;
- never automatically becomes Organizer;
- cannot remove/bypass the last-Organizer invariant;
- cannot grant itself `organizer.manage`.

### Team Member

Confirmed default field role:
- may edit operational data inside its own Team;
- includes own-Team Areas, Street/House/Pickup Tasks and ordinary field status changes;
- may not edit another Team merely by supplying another Team id;
- receives no Organization/Admin/permission authority from Team membership.

### Team Leader

Optional opt-in Team role.

Confirmed default:
- includes all normal Team Member own-Team operational editing;
- additionally manages Team name and color;
- additionally manages Team members/invites within that Team;
- additionally manages Team Field Groups/live-group settings within that Team;
- does not automatically gain Campaign-wide, Admin or Organizer authority.

These are **defaults, not hard-coded permanent rights**. The Organization may configure role templates differently later, subject to delegation ceilings and hard security invariants.

### Viewer

Read-only where explicitly assigned.

## Model: named role templates and explicit scopes

A user/account receives one or more role assignments at Organization, Campaign or Team scope. Each role template contains known reviewed capability keys.

V1 proposal still avoids arbitrary hidden per-user allow/deny exceptions. Different combinations use named role templates, keeping effective access explainable and auditable.

Scope hierarchy:
1. Organization;
2. Campaign;
3. Team.

Organization tenant boundary is absolute and cannot be overridden by any role.

## Candidate capability registry

Stable server-known keys include:
- `team.create`
- `team.rename`
- `team.change-color`
- `team.archive-or-delete`
- `team.member-manage`
- `area.create`
- `area.edit-own-team`
- `area.edit-other-team`
- `area.delete`
- `task.edit-own-team`
- `task.edit-other-team`
- `task.delete`
- `invite.manage-own-team`
- `invite.manage-other-team`
- `live-group.create`
- `live-group.manage`
- `live-group.discoverability`
- `comment.create`
- `comment.moderate`
- `statistics.view`
- `analytics.export`
- `campaign.settings`
- `campaign.create-from-template`
- `template.manage`
- `permission.manage`
- `admin.manage`
- `organizer.manage`

Permanent Action deletion is a hard-coded Organizer invariant, not a delegable capability.

New capability keys require code, server authorization tests and documentation. Arbitrary user-defined strings are never executable permissions.

## Effective authorization

For every protected target:
1. authenticate account/session;
2. resolve target Organization server-side;
3. require active Organization membership;
4. load active assignments whose scope contains the target;
5. union known capability keys;
6. apply hard-coded security/product invariants;
7. deny when required authority is absent.

Hard-coded invariants always win:
- no cross-Organization access;
- last effective Organizer cannot be removed;
- Team scope cannot escape to another Team;
- Admin cannot self-promote to Organizer;
- Organizer-only permanent Action deletion cannot be delegated through a custom role;
- high-risk identity/recovery operations may require stronger re-authentication.

## Team scope resolution

Own-Team capabilities are resolved from canonical server data, not caller assertions.

Worker resolves:
- Area -> Team;
- Task -> Area -> Team;
- Field Group -> Team;
- Team membership/assignment.

A Team Member/Leader may edit only resources whose canonical Team matches an active assignment.

## Organizer/Admin delegation

Confirmed direction:
- Organizers have `admin.manage` by default;
- Organizers may delegate `admin.manage` to selected Admin role templates;
- delegated Admins can manage normal Admins only within the defined delegation ceiling;
- only Organizer may grant/remove Organizer status;
- only Organizer may create/assign roles containing `organizer.manage`;
- delegated Admin cannot grant a role that exceeds what Organizer policy allows it to delegate;
- all such changes are audited.

## Role-template safety

Proposed:
- Organization owns named role templates;
- built-in role defaults may be cloned/adjusted where allowed;
- capabilities are selected only from the hardcoded registry;
- template assignment scopes are explicit;
- dangerous capabilities are visually prominent;
- template updates are audited;
- assigned templates are archived/deactivated rather than destructively removed where needed for history.

## Current access links coexistence

Legacy Campaign Admin/Team Editor/Viewer links remain separate field credentials during migration.

Never silently convert a legacy access-link session into an Organization Organizer/Admin account. Migration/coexistence requires a dedicated implementation slice.

## UI requirements

Admin UI should show:
- role name and scope;
- Organizer/Admin/Team Member/Team Leader identity;
- effective capability summary;
- built-in vs custom role;
- configurable defaults clearly separated from hard security invariants;
- dangerous capabilities (`organizer.manage`, `admin.manage`, `permission.manage`, cross-Team editing);
- what accounts/resources will be affected.

UI visibility never substitutes for Worker authorization.

## Audit requirements

Record tenant-scoped events for:
- role template create/change/archive;
- assignment add/remove;
- Admin add/promote/demote/disable;
- Organizer add/promote/demote/disable;
- admin-management delegation changes;
- last-Organizer transfer/recovery;
- high-risk capability changes;
- Organizer permanent Action deletion;
- Admin analytics export creation once implemented.

Never include passwords, TOTP secrets/codes, recovery codes or session/join secrets.

## Rejected

### Every Admin automatically creates Admins
Rejected. Delegation is explicit.

### Team Member read-only by default
Rejected. Normal Team members are expected to edit their own Team's operational work.

### Team Leader required for ordinary field editing
Rejected. Team Leader is optional and exists for additional Team-management responsibility.

### Raw client-side permission booleans as authority
Rejected. Worker remains authoritative.

### Arbitrary hidden per-user capability exceptions in v1
Not recommended. Named role templates remain the proposed mechanism.

## Remaining acceptance decisions

1. Confirm v1 role templates only, without hidden per-user exceptions.
2. Confirm template update/version behavior for existing assignments.
3. Define current access-link coexistence/migration.
4. Accept ADR-0015 identity/session and re-authentication policy for high-risk Organizer actions.
5. Define exact temporary Field Group member capabilities under ADR-0014.

## Required implementation gates

- additive D1 migration only;
- all permission SQL prepared/parameterized;
- Worker tests for every capability family;
- cross-Organization negative tests;
- own-Team/other-Team negative tests;
- Team Member can edit own Team but not another Team;
- Team Leader defaults can be changed only within allowed role-template policy;
- concurrent last-Organizer removal test;
- Admin cannot self-escalate to Organizer;
- delegated `admin.manage` cannot grant Organizer authority;
- Organizer-only permanent Action delete negative tests for Admin/Team roles;
- audit event tests;
- client tests proving hidden/disabled controls are never the security boundary.

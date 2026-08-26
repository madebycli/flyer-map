---
id: ADR-0016
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0016: Organization/Campaign capability model and role templates

## Status

Proposed only. Product hierarchy was clarified on 2026-08-26: an Organization has an **Organizer** role above normal Admins, and Organizers can add/manage Admins. No permission tables, capability checks replacing current roles, or Admin permission UI writes are authorized until this ADR is explicitly accepted after ADR-0015 identity/session boundaries are understood.

## Context

Plan 012 requires more control than the current fixed `Admin / Team Editor / Viewer` Campaign roles while preserving understandable administration and strict server-side authorization.

Requirements:
- deny by default;
- Organization tenant boundary is absolute;
- UI visibility is never the authorization boundary;
- capability/role changes are audited;
- at least one effective Organizer must remain protected;
- normal Admins must not automatically be able to promote arbitrary new Admins/Organizers;
- arbitrary permission combinations must not become impossible to understand/support;
- existing Campaign access links need a migration/coexistence path.

## Proposed v1 model: named role templates, no per-user capability exceptions

A user/account receives one or more role assignments at explicit scopes. Each role template contains a reviewed set of capability keys.

V1 deliberately does **not** add per-user allow/deny overrides. If a different combination is needed, an authorized Organizer/Admin creates or clones a named custom role template within their delegation ceiling.

Benefits:
- effective access remains inspectable and explainable;
- fewer hidden exceptions;
- permission changes are easier to audit/test;
- Admin UI can show “this member has role X at scope Y” rather than reconstructing a giant matrix.

If real usage proves per-user exceptions necessary, add them through a later ADR.

## Scopes

Proposed scope hierarchy:
1. Organization;
2. Campaign;
3. Team.

A role assignment always carries an Organization id and may narrow to Campaign/Team.

No assignment can reference or authorize an entity from another Organization.

## Candidate capability keys

Use stable machine keys, initially aligned with Plan 012:
- `team.create`
- `team.rename`
- `team.change-color`
- `team.archive-or-delete`
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

New capability keys require code + server authorization tests and should not be created dynamically from arbitrary user strings at runtime.

## Built-in role direction

### Organization Organizer

System role above normal Admins, not freely editable.

Confirmed product responsibility:
- may add/promote/disable Organization Admins according to accepted identity/re-authentication policy;
- may manage Organization-wide role templates/permissions;
- may create/archive Campaigns and manage templates;
- may view/export Organization/Campaign operational analytics where allowed;
- may manage other Organizers only under a stricter accepted policy;
- subject to a **last effective Organizer** invariant;
- cannot cross Organization boundary.

Organizer is the authority that creates/manages Admins. This prevents every normal Admin from automatically becoming an administrator-of-administrators.

### Organization Admin

System or built-in role for normal Organization operations.

Default direction:
- broad operational authority across Campaigns according to accepted capability set;
- may manage Campaigns, Teams, Areas, Tasks, sessions, statistics and exports;
- does **not** automatically receive `organizer.manage`;
- does **not** automatically gain the right to create/promote Organizers;
- whether an Admin may add other Admins is denied by default in v1 unless an Organizer explicitly delegates an accepted safe role/capability model.

### Campaign Admin

Campaign-scoped management role for normal Campaign operations. Does not automatically gain Organization account/security management.

### Team Coordinator

Team-scoped role with Team/Area/Task/invite/live-group management within assigned Team according to accepted capability set.

### Team Editor

Conservative successor to current Team Editor: Task/Area editing inside assigned Team, without permission/admin management.

### Viewer

Read-only role with only explicitly granted view capabilities where a view capability is needed. Absence of write keys means write is denied.

Exact built-in capability lists remain acceptance detail and must preserve current behavior during migration.

## Custom role templates

Proposed:
- Organizer may create Organization-owned named role templates;
- normal Admin template-management rights are limited by delegation policy;
- template name/description are inert bounded text;
- capabilities selected only from the hardcoded known key registry;
- template may be limited to allowed assignment scopes;
- editing a template produces an audit event and updates effective authorization for assignments according to explicit versioning semantics;
- destructive template deletion is prevented while assigned, or implemented as archive/deactivate.

## Effective capability evaluation

For a target resource:
1. resolve authenticated account/session;
2. resolve Organization from target resource server-side;
3. require active Organization membership;
4. load active role assignments whose scope includes the target;
5. union capability keys from those role templates;
6. apply hard-coded product/security invariants;
7. deny when required capability is absent.

Hard-coded invariants always win. Examples:
- tenant boundary cannot be overridden;
- last effective Organizer cannot be removed accidentally;
- a Team-scoped assignment cannot operate on another Team merely because a request supplies its id;
- current protected recovery/security operations may require stronger re-authentication even when a management capability exists.

## Own-Team vs other-Team

`*-own-team` capabilities require server-side ownership/scope resolution. Caller-supplied `teamId` is not proof that the resource is “own”.

Worker must resolve Area -> Team and Task -> Area -> Team from canonical data before authorizing mutation.

## Delegation safety

A principal with `permission.manage` must not be able to create/assign a role that effectively exceeds the authority the policy permits that principal to delegate.

Initial conservative proposal:
- only Organizer may assign/remove Organization Admin by default;
- only Organizer may assign/remove Organizer, subject to stricter re-authentication/recovery rules;
- only Organizer may create templates containing `organizer.manage`;
- normal Admin may manage only a safe subset explicitly delegated by Organizer policy;
- Campaign/Team managers may assign only an explicit safe subset of role templates within their scope;
- last effective Organizer protection is transactional.

Exact delegation ceiling requires tests before acceptance.

## Current access links coexistence

Existing Campaign Admin/Team Editor/Viewer access links remain separate legacy/field credentials during migration.

Do not silently convert an access-link session into an Organization Organizer/Admin account.

A future migration slice must explicitly map current roles to conservative capability sets and define which Organizer/Admin role may manage those grants.

## UI requirements

Admin permission UI should show:
- role name;
- scope;
- effective capability summary;
- whether role is built-in or custom;
- whether the account is Organizer, Admin or lower-scope manager;
- who/what will be affected by an edit;
- dangerous capabilities (`organizer.manage`, `admin.manage`, `permission.manage`, cross-Team editing) prominently;
- no implication that hiding a toggle enforces security.

## Audit requirements

Record tenant-scoped events for:
- role template created/renamed/changed/archived;
- role assignment added/removed;
- Admin added/promoted/demoted/disabled;
- Organizer added/promoted/demoted/disabled;
- last-Organizer transfer/recovery action;
- high-risk capability changes;
- admin-only analytics export creation when implemented.

Never include session/password/TOTP secrets in audit payloads.

## Rejected for v1: every Admin can create Admins automatically

Reason:
- makes privilege escalation too broad;
- weakens the distinction requested between Organizer and Admin;
- complicates last-authority recovery and auditing;
- a compromised normal Admin account should not automatically be able to create more top-level administrators.

## Rejected for v1: raw per-member capability matrix

Reason:
- hard to explain and review;
- easy to accumulate invisible exceptions;
- difficult to test/transfer administrators safely;
- substantially increases UI and audit complexity.

## Rejected for v1: client-side permission booleans as authority

Client capability data may optimize UI only. Worker remains authoritative.

## Open acceptance decisions

1. Confirm whether multiple Organizers are allowed/recommended or exactly one Organizer is required at a time.
2. Confirm exact built-in Organizer/Admin capability sets.
3. Confirm whether an Organizer may delegate `admin.manage` to selected Admin roles or only Organizers can ever add Admins.
4. Confirm v1 has role templates only and no per-user overrides.
5. Confirm assignment scope rules for one account holding multiple roles.
6. Define custom role template update/version behavior for existing assignments.
7. Define current access-link coexistence/migration plan.

## Required implementation gates after acceptance

- additive D1 migration only for active identity/permission slice;
- all permission SQL prepared/parameterized;
- Worker unit/integration tests for every capability family;
- cross-Organization negative tests;
- own-Team/other-Team negative tests;
- concurrent last-Organizer removal test;
- Admin-cannot-self-escalate-to-Organizer negative test;
- audit event tests;
- client UI tests proving disabled/hidden actions never substitute for Worker denial.

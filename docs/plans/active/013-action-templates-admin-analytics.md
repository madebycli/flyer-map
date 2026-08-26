---
id: plan-013-action-templates-admin-analytics
type: plan
status: active
last_updated: 2026-08-26
related: [plan-012-platform-app-expansion, ADR-0017, ADR-0018, architecture-organizations, architecture-identity-permissions]
---

# Plan 013 — Reusable Action Templates, Repeated Rounds and Admin Analytics

## Goal

Support recurring flyer-distribution and clothes-collection work without rebuilding the same map planning each time, while keeping each real action's progress/history independent and giving Organizers/Admins a safe export for deep retrospective analysis.

This plan is experimental and must not be treated as shipped behavior while its work remains on Workbench branches.

## Confirmed product model

### Action Template
Reusable planning blueprint.

May contain:
- default map view;
- Team structure/names/colors;
- Areas and reviewed geometry;
- planned Street/House planning geometry where available;
- non-secret operational defaults after explicit acceptance.

Must never copy:
- prior completion status;
- prior entity ids as new operational identity;
- Field Groups/room codes/QR credentials;
- Field Sessions/history;
- comments;
- access/session secrets;
- pickup completion.

### Action / Aktion
One concrete operational round.

Examples:
- `Frühjahr 2027 Flyer-Verteilung`;
- `Frühjahr 2027 Kleider-Abholung`;
- `Herbst 2027 Flyer-Verteilung`.

Every action gets fresh progress and history.

### Field Session / Einsatz
One concrete outing inside an action with explicit start/end or duration, participant count, Team/Field Group and affected work.

### Action Cycle
Optional grouping for related actions, typically one flyer distribution followed by its collection.

The real workflow commonly has about two cycles per year, but no schema/UI may hardcode exactly two.

## Workbench already prepared

PR #49 currently provides architecture-neutral building blocks:
- `ActionTemplateBlueprint`;
- extraction of reusable planning from a Campaign snapshot without operational completion/history/credentials;
- clean Distribution Action draft with planned Street work reset to `open`;
- clean Collection Action draft with reused planning context and no pre-created Pickup tasks;
- controlled Admin template UI;
- strict allowlist single-action analytics export;
- repeated-action comparison helpers;
- AI analysis/comparison prompts;
- CSV formula-injection protection;
- prompt-injection instruction boundary;
- controlled Admin export UI.

No D1 migration, endpoint or automatic AI call exists.

## Admin analysis package

### Single action
Expected portable files:
- `analytics.json`;
- `teams.csv`;
- `areas.csv`;
- `sessions.csv`;
- `events.csv`;
- `AI_ANALYSE_PROMPT.md`.

### Multiple actions
Expected comparison files:
- `comparison.json`;
- `actions.csv`;
- `AI_VERGLEICHS_PROMPT.md`.

### Analysis goals

Prompt should help Organizers/Admins answer:
- Where were recurring problems?
- Which Areas took too much person-time?
- Which Teams had disproportionately high/low workload after accounting for task amount and time?
- Which Team should receive less/more work next time?
- Did previous improvements help?
- Were Area boundaries realistic?
- How should Team allocation, session duration or participant count change next time?

AI output is advisory only. It never changes assignments, permissions or statuses automatically.

## Export privacy/security

Initial export is strict allowlist.

Excluded by design:
- passwords;
- TOTP secrets/codes;
- recovery codes;
- access/session/join secrets;
- raw HTTP bodies/headers/cookies;
- continuous GPS trails;
- device fingerprints;
- comment bodies;
- Field Session free-text notes;
- unnecessary account/personal data.

Requirements:
- fixed server-owned output filenames;
- CSV user-controlled values neutralize `=`, `+`, `-`, `@` formula prefixes;
- AI prompt explicitly says exported values are data, not instructions;
- all future reads/export queries are tenant scoped server-side;
- `analytics.export` or equivalent capability is required;
- export creation is audited;
- no direct AI service access is required for v1; user/admin can use the portable package with an AI separately.

## Organizer/Admin relationship

Confirmed product hierarchy:
- Organizer is above normal Admin;
- Organizer can add/manage Admins according to accepted re-authentication/delegation policy;
- normal Admin cannot silently become Organizer;
- last effective Organizer must be protected;
- Admin/Organizer analytics access requires explicit capability.

Account/permission runtime remains blocked by ADR-0015/ADR-0016/threat-model acceptance.

## History relationship

ADR-0017 direction:
- meaningful operational history is retained;
- no automatic ordinary-history expiry after 12/24 months;
- exact old geometry is not required for initial reflection;
- current/reviewed Task geometry plus retained historical references is sufficient;
- repeated-action comparison consumes retained operational history.

## Implementation slices after architecture acceptance

### Slice A — Template persistence
- accept ADR-0018 D1 representation;
- additive migration;
- application-owned template/version ids;
- tenant-scoped create/read/update/archive;
- no credential/history copying;
- safe clone-from-existing-action flow;
- template version/revision relationship.

### Slice B — Create Action from Template
- create fresh action ids;
- copy reviewed planning only;
- Distribution Tasks start open;
- Collection Pickup Tasks start empty;
- record template/version provenance;
- optional Action Cycle linkage;
- transaction/idempotency tests.

### Slice C — Retained history/session persistence
- only after ADR-0017 acceptance;
- Field Sessions + minimal domain events;
- M5 idempotency ensures retries do not duplicate events;
- no GPS trace storage.

### Slice D — Admin analytics query/export
- only after Organizer/Admin capabilities are accepted;
- server-side tenant/action authorization;
- bounded export size;
- strict allowlist serialization;
- fixed file names;
- audited export creation;
- downloadable package/UI.

### Slice E — Repeated-action comparison UI
- select actions/template/cycle;
- compare distributions/collections separately;
- show descriptive deltas and context;
- no opaque Team performance score;
- produce comparison prompt/package.

## Acceptance gates

Before persistence:
- decide exact Template/Action/Cycle D1 representation;
- decide whether Action Cycle is optional vs mandatory;
- decide which non-secret defaults belong in Template;
- decide whether Collection may exist independently of a prior Distribution Action;
- decide action archive/permanent deletion policy;
- accept ADR-0017 and ADR-0018 as applicable.

Before Admin export runtime:
- accepted Organizer/Admin capability policy;
- cross-Organization negative authorization tests;
- export-size and memory limits;
- formula-injection tests;
- prompt-injection boundary tests;
- no-secret/privacy regression tests;
- audit event test;
- retained-history queries proven bounded on expected action history sizes.

## Current open product decisions

1. Multiple Organizers allowed/recommended or exactly one active Organizer at a time?
2. May selected Admins be delegated `admin.manage`, or only Organizers may add Admins?
3. Should Template include non-secret operational defaults such as Team colors, map view and Live Group visibility defaults?
4. Should Collection normally link to Distribution but still be independently creatable for special cases?
5. Should normal completed actions archive/retain everything, with permanent delete restricted to an explicit Organizer-only destructive flow?

## Explicit non-goals

- no hardcoded twice-per-year schedule;
- no automatic AI call with private data;
- no AI-controlled assignments/permissions;
- no worker/person productivity score;
- no exact continuous GPS route history;
- no reuse of old completion status in a new action;
- no copied secrets from a template;
- no all-at-once schema migration.

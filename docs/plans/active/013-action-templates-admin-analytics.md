---
id: plan-013-action-templates-admin-analytics
type: plan
status: active
last_updated: 2026-08-26
related: [plan-012-platform-app-expansion, ADR-0017, ADR-0018, architecture-organizations, architecture-identity-permissions]
---

# Plan 013 — Reusable Action Templates, Repeated Rounds and Admin Analytics

## Goal

Support recurring flyer-distribution and clothes-collection work without rebuilding planning each time, while keeping every real action independent and giving Organizers/Admins safe retrospective exports.

This remains experimental Workbench scope and is not shipped behavior.

## Confirmed product model

### Template
Reusable non-secret planning blueprint.

Confirmed:
- templates can be created, downloaded as a portable file and loaded/selected when creating a new action;
- Flyer Distribution and Clothes Collection use **separate template types**;
- templates may contain map view, Team names/colors, Areas, reviewed road/house planning and normal defaults such as `online anzeigen = an`;
- templates never contain prior completion, Sessions, Groups, comments or credentials.

### Action / Aktion
One concrete operational round with fresh ids, progress and history.

Examples:
- `Frühjahr 2027 Flyer-Verteilung`;
- `Frühjahr 2027 Kleider-Abholung`;
- `Herbst 2027 Flyer-Verteilung`.

### Field Session / Einsatz
One outing inside an action.

### Action Cycle
Optional reporting/grouping concept for related rounds. The product may commonly run two cycles per year, but frequency is never hardcoded.

## Distribution vs Collection planning

Distribution Template:
- distribution Teams/Areas;
- reviewed Street/House planning;
- fresh distribution work starts open.

Collection Template:
- separately designed car/collection Teams;
- often more and smaller Areas;
- collection-specific planning boundaries;
- does **not** inherit who distributed where;
- starts with fresh collection road/pickup work.

A Collection Action may still be grouped with a Distribution Action for retrospective comparison, but their assignment structures remain independent.

## Workbench prepared in PR #49

- mode-specific `ActionTemplateBlueprint`;
- Distribution Template extraction from current Campaign planning;
- purpose-built Collection Templates;
- portable `flyer-map-action-template` JSON file with strict import validation;
- local download/import UI;
- clean new-action drafts;
- controlled Admin template surface;
- strict allowlist single-action analytics export;
- repeated-action comparison;
- AI analysis/comparison prompts;
- CSV formula-injection protection;
- prompt-injection boundary;
- controlled Admin export UI.

No D1 migration, endpoint or automatic AI call exists.

## Admin analysis package

Single action:
- `analytics.json`;
- `teams.csv`;
- `areas.csv`;
- `sessions.csv`;
- `events.csv`;
- `AI_ANALYSE_PROMPT.md`.

Comparison:
- `comparison.json`;
- `actions.csv`;
- `AI_VERGLEICHS_PROMPT.md`.

Analysis asks for bottlenecks, problem Areas, person-time/workload imbalance, which Teams should receive more/less work next time, Area sizing and concrete improvements. It remains advisory and must explain evidence/context instead of producing an opaque punishment/ranking score.

## Organizer/Admin direction

Confirmed:
- multiple Organizers are allowed;
- at least one effective Organizer must always remain;
- Organizer has `admin.manage` by default;
- Organizer may explicitly delegate `admin.manage` to selected Admin roles;
- Admins never receive Organizer authority from that delegation;
- permanent Action deletion is Organizer-only and non-delegable in the current product direction;
- normal completion uses archive/retained history.

Identity/permission runtime remains blocked by ADR-0015/ADR-0016/threat-model acceptance.

## Team access direction

Confirmed product intent:
- normal members of a Team can edit operational data inside their own Team, including assigned Areas/Tasks, subject to server-side Team scope;
- an optional Team Leader role may add Team-management responsibilities;
- exact Team Leader extras such as Team metadata/member/invite management remain a small product decision;
- no Team role may edit another Team without explicit higher-scope capability.

## Permanent Action deletion

Normal path:
- completed Action is archived;
- retained history/statistics remain available.

Destructive path:
- Organizer only;
- server re-authorizes Organizer capability;
- UI shows the exact Action being removed;
- user must type a fixed confirmation phrase before the request can be submitted;
- initial Workbench phrase: `AKTION LÖSCHEN`;
- deletion creates a security/admin audit event without copying secrets;
- final D1 retention/cascade behavior still requires accepted persistence ADRs.

## History relationship

ADR-0017 direction:
- meaningful operational history retained;
- no ordinary 12/24-month expiry;
- exact old geometry reconstruction not required for initial reflection;
- retained references support repeated-action comparison and AI export.

## Implementation slices after architecture acceptance

### A — Template persistence
- accepted D1 representation;
- additive migration;
- application-owned Template/version ids;
- tenant-scoped CRUD/archive;
- safe file import/export;
- no credentials/history copying.

### B — Create Action from Template
- fresh Action ids/state;
- template/version provenance;
- mode-specific planning;
- optional cycle relation;
- idempotency/transaction tests.

### C — History/session persistence
- after ADR-0017 acceptance;
- Sessions + minimal events;
- no GPS trail;
- no duplicate events on M5 replay.

### D — Admin analytics export
- after Organizer/Admin capability acceptance;
- bounded tenant-scoped export;
- strict allowlist;
- audit event;
- downloadable package.

### E — Repeated-action comparison
- compare compatible actions/template versions;
- Distribution/Collection separate;
- descriptive deltas/context;
- advisory AI prompt/package.

### F — Archive and Organizer-only permanent deletion
- archive is normal completion/removal path;
- hard delete hidden from normal Admin/Team roles;
- fixed phrase confirmation plus server-side Organizer re-check;
- retained-history/cascade policy explicitly tested.

## Remaining decisions before persistence

1. Exact Template/Action/Cycle D1 representation.
2. Whether Action Cycle is optional metadata or required for every action.
3. Final template version/update UX.
4. Whether Collection Actions may exist outside a Cycle.
5. Team Leader extra management capabilities.
6. Comment moderation/history details from ADR-0017.
7. Accept ADR-0016/0017/0018 as applicable before runtime.

## Explicit non-goals

- no hardcoded twice-per-year schedule;
- no automatic AI call with private data;
- no AI-controlled assignment or permissions;
- no opaque worker/person score;
- no continuous GPS route history;
- no copied old completion state or secrets;
- no Distribution assignment reuse for Collection;
- no all-at-once schema migration.

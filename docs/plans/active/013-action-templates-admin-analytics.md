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

## Confirmed model

- **Distribution Template** and **Collection Template** are separate reusable planning artifacts.
- Template may contain map view, Team colors/names, Areas, reviewed road/house planning and normal non-secret defaults such as `online anzeigen = an`.
- Template can be downloaded and later loaded/selected when creating an Aktion.
- Template never carries completion state, old operational ids, Sessions, Field Groups, comments or credentials.
- **Aktion** is one concrete operational round with fresh ids/progress/history.
- **Einsatz / Field Session** is one outing inside an Aktion.
- optional **Action Cycle** may group related Distribution/Collection rounds for reporting; frequency is never hardcoded.

## Distribution vs Collection planning

Distribution Template:
- distribution Teams/Areas;
- reviewed Street/House planning;
- fresh distribution work starts open.

Collection Template:
- independently designed car/collection Teams;
- often more and smaller Areas;
- collection-specific boundaries;
- does not inherit who distributed where;
- fresh pickup/collection work.

## PR #49 Workbench

Prepared:
- mode-specific Template model;
- Distribution extraction from current Campaign planning;
- purpose-built Collection Templates;
- validated portable `flyer-map-action-template` JSON files;
- browser-local download/import UI;
- clean new-action drafts;
- single-action Admin analytics export;
- repeated-action comparison;
- AI prompts;
- CSV formula-injection protection;
- prompt-injection boundary;
- controlled Admin export UI.

Mode separation + portable file CI #379 passed before later documentation-only refinements. Final head must remain green before promotion.

No D1 migration, endpoint or automatic AI call exists.

## Admin analytics package

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

AI output is advisory only. It must use workload/context/person-time, identify uncertainty, and never become an opaque Team punishment score or automatic assignment engine.

## Organizer/Admin rules

Confirmed:
- multiple Organizers allowed;
- at least one effective Organizer retained;
- Organizer has `admin.manage` by default;
- Organizer may delegate `admin.manage` to selected Admin roles;
- delegated Admin never becomes Organizer;
- permanent Action deletion is Organizer-only/non-delegable;
- archive + retained history is normal lifecycle.

## Team access

Confirmed:
- ordinary Team members can edit own-Team operational Areas/Tasks;
- optional Team Leader may add Team-management responsibilities;
- exact extra Team Leader rights remain open;
- Worker must enforce canonical Team scope.

## Organizer-only permanent deletion

- archive is normal path;
- hard delete requires Organizer;
- UI identifies target Aktion;
- fixed Workbench confirmation phrase `AKTION LÖSCHEN`;
- Worker must later re-authorize Organizer and audit deletion;
- exact retained-history/cascade behavior waits for persistence ADR acceptance.

## Implementation slices after architecture acceptance

A. Template persistence + versioning + safe file import/export.

B. Create Aktion from mode-compatible Template with fresh state/provenance.

C. Retained Session/event history after ADR-0017 acceptance.

D. Bounded tenant-scoped Admin analytics export after permission acceptance.

E. Repeated-action comparison UI/package.

F. Archive + Organizer-only permanent delete with explicit retention/cascade tests.

## Remaining decisions

1. exact Template/Action/Cycle D1 representation;
2. Action Cycle optional vs mandatory;
3. final Template version/update UX;
4. whether Collection may exist outside a Cycle;
5. exact Team Leader extras;
6. remaining history/comment semantics;
7. accept ADR-0016/0017/0018 before their runtime slices.

## Non-goals

- no hardcoded twice-per-year schedule;
- no automatic AI upload/call;
- no AI-controlled permissions/assignments;
- no worker/person score;
- no continuous GPS history;
- no copied old completion/secrets;
- no Distribution assignment reuse for Collection;
- no all-at-once migration.

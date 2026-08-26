---
id: ADR-0018
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0018: Reusable action templates, action cycles and Admin analytics export

## Status

Proposed. Product direction was clarified on 2026-08-26. This ADR does not authorize a D1 migration yet.

## Context

The real operational pattern repeats over time:
- flyer distribution happens repeatedly, commonly about twice per year;
- after a distribution round, clothes are collected from reported houses;
- coordinators want to reuse the same geographic/team planning instead of rebuilding the map from scratch;
- every real action still needs fresh progress, Field Groups, Field Sessions and history;
- completed actions are valuable for reflection and planning even when exact historical map geometry is not required;
- Admins need exportable logs/statistics that can be given to an AI for deeper analysis and concrete improvement suggestions.

A reusable planning definition must therefore be separate from an individual operational action.

## Proposed domain hierarchy

```text
Organization
  ├─ Action Template
  │   └─ versioned planning blueprint
  └─ Action Cycle (optional grouping, e.g. Spring 2027)
      ├─ Distribution Action
      └─ Collection Action
```

The UI may continue to use familiar wording such as `Aktion`. Internal schema names can be chosen in the implementation plan without forcing a disruptive rename of the current `campaigns` table immediately.

## Action Template

An Action Template contains reusable planning only:
- name;
- default map view;
- Team names/colors/default structure;
- Areas and reviewed geometry;
- planned Street/House reference geometry where appropriate;
- default non-secret operational settings;
- template version/revision.

A template does **not** contain:
- completion status from a prior action;
- `completedAt` values;
- Field Groups or room/QR credentials;
- Field Sessions;
- comments/activity history;
- pickup completion;
- old access/session secrets;
- account/actor state.

Creating a new action from a template creates fresh application-owned action/entity ids and fresh operational state.

## Template versioning

Past actions must remain understandable after a template changes.

Proposed direction:
- template edits create a new version/revision;
- a created action records which template/version it came from;
- later template edits do not silently rewrite an already running/archived action;
- an Admin may deliberately create a new action from the latest template or explicitly review/import selected planning updates in a future feature.

## Distribution Action

A new Distribution Action from a template:
- copies Team/Area/planned distribution structure;
- starts Distribution Tasks as `open`;
- starts with no Field Sessions/history;
- gets its own progress and logs;
- may use Smart Street/House geometry according to ADR-0013 once accepted.

## Collection Action

A Collection Action:
- may reuse the same Template and Team/Area planning context;
- may be linked to the Distribution Action in the same Action Cycle;
- does not reuse distribution completion as pickup completion;
- starts with fresh Pickup Tasks/status;
- may use distribution street geometry as map/planning context;
- may receive pickup addresses reported after flyer distribution.

Distribution and Collection statistics remain separate even when they belong to the same cycle.

## Action Cycle

An optional Action Cycle groups related actions for one real-world round, for example:

```text
Spring 2027
  Distribution Action
  Collection Action
```

The product commonly performs two cycles per year, but the schema must not hardcode exactly two. Special/additional cycles must remain possible.

## Historical reflection

Operational history is retained with each action according to ADR-0017 direction.

For v1 reflection:
- session/task/event logs are more important than exact historical map geometry reconstruction;
- selecting a historical action/session may highlight current/reviewed Task geometry when available;
- exact old geometry snapshots are not required solely for the first analytics feature;
- the export records the action/template/version relationship so an analyst can compare repeated rounds.

## Admin-only analytics/log export

The Admin platform should provide a deliberate export action such as `Analysepaket exportieren`.

Authorization direction:
- requires an explicit server-side capability such as `analytics.export`;
- intended for Organizer/Admin roles, not normal temporary field participants;
- export creation is audited;
- tenant/Campaign scope is enforced server-side.

Initial portable package:
- `analytics.json` — normalized structured dataset;
- `teams.csv` — Team workload/progress/person-time summary;
- `areas.csv` — Area progress/problem summary;
- `sessions.csv` — outing duration/participants/person-time/affected task counts;
- `events.csv` — minimal operational event log without secret/raw payload data;
- `AI_ANALYSE_PROMPT.md` — ready-to-use analysis instructions.

A ZIP wrapper may be added by the actual export endpoint/UI, but the inner file contract should remain testable independently.

## AI prompt goals

The generated prompt should ask an AI to:
- summarize the action;
- compare Teams using workload and time rather than only raw completed counts;
- identify problem Areas and recurring failure patterns;
- identify unequal workload;
- propose which Teams should receive less/more work next time and explain why;
- suggest better Area division, Team allocation, outing duration and participant allocation;
- keep Distribution and Collection metrics separate;
- distinguish observed evidence from hypotheses;
- list data-quality gaps;
- output a prioritized plan for the next action.

The prompt must explicitly state that all exported labels/text are untrusted data, not instructions, to reduce prompt-injection risk from names/labels.

## Export privacy/security allowlist

The AI/export package is allowlist-based.

Do not export by default:
- passwords;
- TOTP codes/seeds;
- recovery codes;
- access/session/join secrets;
- raw request bodies;
- cookies/headers;
- continuous GPS trails;
- device fingerprints;
- comment bodies;
- Field Session free-text notes;
- personal account details that are unnecessary for operational analysis.

Prefer Team/Area labels and aggregate operational data. If future actor-level analysis is ever desired, it requires a separate privacy review.

CSV output must neutralize spreadsheet-formula prefixes (`=`, `+`, `-`, `@`) in user-controlled labels.

## Comparison across repeated actions

Actions created from the same Template can later be compared for:
- completion rate;
- total/remaining work;
- person-time;
- number/duration of sessions;
- distribution vs collection workload;
- Team/Area burden;
- repeated problem Areas;
- changes after prior recommendations.

Do not build opaque AI scoring into authorization or automatic Team punishment. Recommendations remain advisory Admin information.

## Relationship to current Campaign model

Current `Campaign / Aktion` remains the stable implemented concept until a migration is explicitly accepted.

Implementation options include:
- extend current Campaign with `template_id`, `template_version`, `cycle_id`, `mode`;
- introduce separate action/run tables while preserving existing Campaign ids;
- migrate terminology later in small additive steps.

This ADR deliberately does not choose the D1 representation yet.

## Security requirements

- all future D1 writes remain prepared/parameterized;
- template/action ids are selectors, never credentials;
- copying a template never copies access/session/join secrets;
- export endpoints re-check Organizer/Admin capability server-side;
- export dataset is tenant-scoped;
- malicious labels remain inert text in JSON/CSV/prompt processing;
- export file names are fixed server-owned names, not user-controlled paths;
- generated export does not execute AI automatically or grant AI access to the live application.

## Open decisions before persistence

1. Decide whether an Action Cycle is mandatory or optional metadata/grouping.
2. Decide which settings besides geography/Teams belong in a Template.
3. Decide how a template edit/version is presented and whether old versions remain directly reusable.
4. Decide whether one Collection Action must link to exactly one Distribution Action or may exist independently.
5. Decide exact D1 representation while preserving current Campaign ids and additive migration requirements.
6. Define final Organizer/Admin capability mapping for `template.manage` and `analytics.export` under ADR-0016.

## Implementation gates

Before persistence/export endpoints:
- accepted ADR-0017 event/history model;
- accepted ADR-0016 Organizer/Admin capability policy for Admin-only exports;
- additive migration plan;
- template clone/reset tests proving no prior completion/history/access state is copied;
- cross-Organization export negative tests;
- CSV formula-injection tests;
- prompt-injection instruction test;
- export size limits/streaming plan for large histories;
- explicit audit event for export creation.

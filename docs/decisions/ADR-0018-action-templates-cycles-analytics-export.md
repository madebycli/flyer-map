---
id: ADR-0018
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0018: Reusable action templates, action cycles and Admin analytics export

## Status

Proposed. Several product directions were confirmed on 2026-08-26. This ADR still does not authorize a D1 migration.

## Context

The real workflow repeats over time:
- flyer distribution happens repeatedly, commonly about twice per year;
- clothes collection is a later operational action;
- coordinators want reusable planning instead of rebuilding every action from scratch;
- every real action needs fresh progress, Field Groups, Field Sessions and history;
- Distribution and Collection do not necessarily use the same Team/Area structure;
- completed actions are valuable for reflection and Admin-only analysis exports.

A reusable planning definition must therefore be separate from an individual action.

## Domain hierarchy

```text
Organization
  ├─ Distribution Template
  ├─ Collection Template
  └─ Action Cycle (optional grouping, e.g. Spring 2027)
      ├─ Distribution Action
      └─ Collection Action
```

`Action Template`, `Action/Aktion` and `Field Session/Einsatz` are distinct concepts.

## Confirmed template behavior

A Template stores reusable non-secret planning:
- template mode: `distribution` or `collection`;
- name;
- default map view;
- Team names/colors;
- Areas and reviewed geometry;
- planned road/house geometry appropriate to that template;
- normal operational defaults such as `online anzeigen = an` for newly created Field Groups;
- later persisted template version/revision.

A Template never stores:
- old completion state or `completedAt`;
- old Campaign/Task ids;
- Field Groups, room codes or QR tokens;
- Field Sessions/history;
- comments/activity;
- passwords, access links, account sessions or other credentials;
- pickup completion from an earlier action.

Creating a new action from a Template creates fresh application-owned operational ids and fresh state.

## Distribution Template

A Distribution Template may be created from a reviewed Distribution Action/Campaign planning state.

A new Distribution Action:
- copies the Distribution Template's Team/Area/planned Street/House structure;
- starts distribution work as open;
- starts with no old Sessions/Groups/history;
- receives its own progress/logs.

## Collection Template is separate

Confirmed product direction: Collection planning must **not** automatically inherit the Distribution Teams/Areas.

Collection work may use:
- different people/vehicles;
- multiple car Teams;
- more and smaller Areas;
- Area boundaries built specifically for efficient pickup driving;
- fresh pickup addresses/tasks reported for that collection round.

Therefore a Collection Action is created from a purpose-built Collection Template. It may be grouped with the Distribution Action in the same Action Cycle for reporting, but it does not copy who distributed where or the old distribution assignment structure.

Distribution and Collection progress/statistics are always separate.

## Portable template file

Confirmed product requirement: Templates can be downloaded and later loaded/selected when a new action is created.

Initial portable file contract:
- JSON;
- explicit product marker `flyer-map-action-template`;
- explicit file version;
- strict schema validation on import;
- bounded file size;
- cross-reference validation for Team/Area/road keys;
- no credentials or historical operational state.

The current workbench uses a file name such as `Vorlagenname.flyer-map-template.json`.

Importing a file only creates/loads a Template candidate. It does not grant authorization or automatically start an action.

## Template versioning

Past actions must remain understandable after a Template changes.

Proposed direction:
- template edits create a new version/revision;
- created actions record Template/version provenance;
- later edits never silently rewrite running/archived actions;
- old versions may remain exportable/reviewable where useful.

## Action Cycle

An optional Action Cycle groups related real-world rounds, e.g.:

```text
Spring 2027
  Distribution Action
  Collection Action
```

The product commonly runs about two cycles per year, but frequency is never hardcoded. A Collection Action may use a separate Collection Template even when grouped in the same cycle.

## Historical reflection

Operational history is retained according to ADR-0017 direction.

For v1:
- retained Sessions/Task events/logs matter more than exact old map geometry reconstruction;
- historical action/session views can use current/reviewed Task references where available;
- exact historical geometry snapshots are not required solely for the first analytics feature;
- Template/version/action relationships are included so repeated rounds can be compared.

## Admin-only analytics/log export

The Admin platform should provide an explicit action such as `Analysepaket exportieren`.

Authorization:
- requires server-side capability such as `analytics.export`;
- intended for Organizer/Admin roles according to ADR-0016;
- export creation is audited;
- Organization/Action scope is enforced server-side.

Initial single-action package:
- `analytics.json`;
- `teams.csv`;
- `areas.csv`;
- `sessions.csv`;
- `events.csv`;
- `AI_ANALYSE_PROMPT.md`.

Repeated-action comparison adds:
- `comparison.json`;
- `actions.csv`;
- `AI_VERGLEICHS_PROMPT.md`.

## AI analysis goals

Prompts should ask for:
- bottlenecks and recurring problem Areas;
- workload/person-time imbalance;
- evidence-based suggestions for which Teams should receive more/less work next time;
- Area sizing/division improvements;
- session/participant allocation improvements;
- comparison across repeated actions;
- separation of observed evidence and hypotheses;
- data-quality gaps;
- prioritized next-action recommendations.

No opaque team punishment/ranking score is authoritative. Recommendations remain advisory Admin information.

Prompts explicitly state that exported labels/text are untrusted data, not instructions.

## Export privacy/security allowlist

Do not export by default:
- passwords/TOTP/recovery codes;
- access/session/join secrets;
- cookies/headers/raw requests;
- continuous GPS trails or device fingerprints;
- comment bodies;
- free Session notes;
- unnecessary personal account details.

CSV output neutralizes spreadsheet-formula prefixes in user-controlled text.

## Relationship to current Campaign model

Current Campaign remains the stable implemented concept until migration is explicitly accepted.

Possible future implementations include extending Campaign with Template/version/cycle/mode fields or introducing separate Action tables while preserving existing Campaign ids. This ADR deliberately does not choose D1 representation yet.

## Security requirements

- all future D1 writes prepared/parameterized;
- Template/Action ids are selectors, never credentials;
- Template export/import never includes access/session/join secrets;
- imported names/labels remain inert text;
- export endpoint re-checks capability server-side;
- export files use server-owned safe paths/names;
- AI is never automatically granted live-app authority.

## Remaining decisions before persistence

1. Decide whether Action Cycle is mandatory or optional grouping metadata.
2. Decide final template version/update UX.
3. Decide exact D1 representation while preserving existing Campaign ids through additive migrations.
4. Confirm final Organizer/Admin mapping for `template.manage` and `analytics.export` under ADR-0016.
5. Decide whether Collection Actions may exist completely outside an Action Cycle or every collection should belong to one cycle for reporting.

## Implementation gates

Before persistence/export endpoints:
- accepted ADR-0017 event/history model;
- accepted ADR-0016 permission policy;
- additive migration plan;
- template reset tests proving no completion/history/access state is copied;
- template file round-trip, malformed-file and broken-reference tests;
- cross-Organization export negative tests;
- CSV formula-injection tests;
- prompt-injection instruction test;
- export size/streaming plan;
- audit event for export creation.

---
id: ADR-0018
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0018: Reusable action templates, action cycles and Admin analytics export

## Status

Proposed. Several product directions were confirmed on 2026-08-26. This ADR still does not authorize a D1 migration.

## Confirmed product direction

- reusable Templates are separate from concrete Aktionen;
- Distribution and Collection use separate Template types;
- Templates may contain non-secret operational defaults such as map view, Team colors and `online anzeigen = an`;
- Templates can be downloaded and later loaded/selected when creating an Aktion;
- importing a Template never grants authority or starts an Aktion automatically;
- Collection planning does not inherit Distribution Team/Area assignments;
- a Collection Template may define different car Teams and more/smaller collection Areas;
- each Aktion starts with fresh operational state/history;
- repeated operational history can be compared through an Admin-only analysis export;
- AI recommendations are advisory only.

## Domain hierarchy

```text
Organization
  ├─ Distribution Template
  ├─ Collection Template
  └─ Action Cycle (optional reporting grouping)
      ├─ Distribution Action
      └─ Collection Action
```

`Template`, `Aktion` and `Einsatz/Field Session` are distinct.

## Template contents

Allowed reusable planning:
- mode (`distribution` or `collection`);
- name;
- default map view;
- Team names/colors;
- Areas and reviewed geometry;
- planned road/house geometry appropriate to the Template;
- non-secret operational defaults;
- future Template version/revision.

Never copied/exported into Template:
- completion status / `completedAt`;
- old operational ids as new identity;
- Field Groups, room codes or QR tokens;
- Field Sessions/history;
- comments/activity;
- passwords, access links, session credentials;
- old pickup completion.

## Portable Template file

Initial workbench contract:
- JSON marker `flyer-map-action-template`;
- explicit file version;
- strict schema validation;
- bounded size;
- Team/Area/road cross-reference validation;
- safe filename generation;
- no credentials/history.

A downloaded file is a portable planning artifact, not a credential.

## Distribution Template

May be derived from reviewed Distribution Campaign planning.

New Distribution Action:
- copies planning only;
- starts planned Distribution work open;
- starts without old Groups/Sessions/comments/history;
- owns fresh ids/progress/logs.

## Collection Template

Purpose-built independently.

Collection may use:
- different people/vehicles;
- several car Teams;
- smaller/differently shaped Areas;
- fresh pickup addresses/tasks;
- optional collection road planning.

It must not copy who distributed where merely because a Distribution Action exists.

Distribution and Collection statistics remain separate even when grouped in one Action Cycle.

## Template versioning

Proposed:
- Template edits create version/revision history;
- Action records Template/version provenance;
- editing a Template never rewrites an existing Action;
- old Template versions remain understandable/exportable where useful.

## Action Cycle

Optional candidate grouping such as `Frühjahr 2027` for reporting/comparison. Frequency is never hardcoded. Collection may use its own Template within the same cycle.

Whether Collection may exist entirely outside a Cycle remains open.

## Historical reflection

Operational history is retained according to ADR-0017.

For v1:
- Sessions/events/task relations matter more than exact old geometry reconstruction;
- current/reviewed Task references are sufficient for initial historical map reflection;
- Template/version provenance helps compare repeated rounds.

## Admin-only analysis export

Requires future server-side `analytics.export` or equivalent capability.

Single-action package:
- `analytics.json`;
- `teams.csv`;
- `areas.csv`;
- `sessions.csv`;
- `events.csv`;
- `AI_ANALYSE_PROMPT.md`.

Repeated-action comparison:
- `comparison.json`;
- `actions.csv`;
- `AI_VERGLEICHS_PROMPT.md`.

Prompts ask for bottlenecks, repeated problem Areas, person-time/workload imbalance, fairer next-action allocation and concrete improvements. They must distinguish evidence from hypotheses and never create an authoritative worker/Team punishment score.

## Privacy/security allowlist

Excluded by default:
- passwords/TOTP/recovery codes;
- access/session/join secrets;
- cookies/headers/raw requests;
- continuous GPS trails/device fingerprints;
- comment bodies;
- free Session notes;
- unnecessary account details.

CSV neutralizes formula prefixes in user-controlled cells. Prompts state that labels/text are untrusted data, not instructions.

## Relationship to current Campaign model

Current Campaign remains stable until a reviewed additive migration. Possible future representation may extend Campaign or introduce Action/Template tables while preserving existing Campaign ids. This ADR does not choose the D1 layout yet.

## Security requirements

- future D1 queries prepared/parameterized;
- Template/Action ids are selectors, never credentials;
- Template copy/export never copies credentials;
- imported values remain inert data;
- analytics endpoint re-checks tenant + capability server-side;
- export creation is audited;
- no automatic AI authority/access to live application.

## Remaining decisions before persistence

1. exact Template/Action/Cycle D1 representation;
2. Action Cycle optional vs mandatory;
3. final Template version/update UI;
4. whether Collection may exist outside a Cycle;
5. final Organizer/Admin capability mapping for Template management/export;
6. accepted ADR-0017 history model.

## Implementation gates

- additive migration only;
- reset tests prove old operational state/credentials are never copied;
- portable file round-trip/malformed/cross-reference tests;
- cross-Organization negative export tests;
- CSV formula-injection tests;
- prompt-injection boundary tests;
- bounded export size/streaming plan;
- audit event for export creation.

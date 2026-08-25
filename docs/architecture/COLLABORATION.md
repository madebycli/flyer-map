---
id: architecture-collaboration
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync, architecture-live-teams, plan-012-platform-app-expansion]
source_of_truth_for: [future-comments, future-activity, future-automations, future-statistics, future-field-sessions]
---

# Collaboration, Field Sessions, Activity, Automations and Statistics — Proposed

## Purpose

Record constraints for future comments, Field Sessions, activity history, automations and statistics. These capabilities are planned but not yet implemented.

## Field Sessions / Einsätze

A Field Session represents one concrete outing/work period by a Team or temporary Field Group.

Candidate fields:
- stable id;
- Campaign id;
- Team id;
- optional Field Group id;
- mode: distribution or collection;
- date;
- start/end timestamps or explicit duration;
- participant count;
- optional note;
- created/closed by actor reference;
- lifecycle timestamps.

### Why sessions exist

Sessions provide the operational memory that coordinators currently reconstruct manually after the fact.

They should answer:
- how often was the Team out?;
- how long did the outing take?;
- how many people participated?;
- what work was completed?;
- was the Area realistically sized?;
- what was the approximate person-time?

### Person-time

Person-time may be calculated from duration × participant count.

It is an operational planning metric, not a worker-ranking metric.

Do not derive it from GPS presence or continuous location history.

## Session work / map highlighting

A session should be related to the actual Task/domain events created or changed while the session is active.

Possible storage direction:
- activity/domain events reference `field_session_id` when applicable;
- session summaries derive affected Task ids from those events;
- map highlight reads those Task ids and highlights current/relevant geometry.

Do not store a continuous route polyline merely to recreate what a Team did.

Historical geometry semantics need an ADR if later requirements demand showing the exact old geometry after Tasks were edited/deleted.

## Comments

Comments should attach to explicit context:
- Campaign;
- Area;
- Task (Street/House/Pickup etc.);
- optionally Field Session if product testing shows value.

Requirements:
- server-authorized read/write scope;
- timestamps and stable ids;
- operational actor reference/label;
- edit/delete/moderation policy defined before implementation;
- no unnecessary personal profile collection.

## Activity history

Meaningful mutations should become append-only activity/domain events once the event model exists.

Candidate events:
- Area created/renamed/geometry changed;
- Task generated/created/status changed/deleted;
- Team created/renamed/color changed/archived;
- Field Session started/closed;
- participant count/duration feedback recorded;
- Field Group created/joined/closed where appropriate;
- pickup address added/status changed;
- comment created;
- automation executed;
- access/admin/permission changes where safe to expose.

Activity supports auditability, session reconstruction and progress statistics.

## Automations

Automations are deterministic domain rules, not opaque AI actions.

Initial candidates:
- new Area -> propose/generate road Tasks from reviewed OSM data;
- all building Tasks for a Street complete -> optionally complete parent Street;
- status mutation -> append activity event;
- progress threshold -> surface coordinator indicator;
- session close -> compute/update derived summary;
- synchronization/retry state -> notify when manual action is required.

Requirements:
- explicit trigger/effect;
- privileged effects obey system/caller authorization rules;
- idempotency prevents duplicate effects;
- execution is observable/auditable;
- failures are visible;
- avoid unnecessary high-frequency polling.

## Statistics

Statistics are operational metrics, not behavioral surveillance.

### Progress measures
Candidate measures:
- completion percentage by Campaign / Team / Area;
- Task totals by status;
- Street completion counts;
- House completion counts;
- Pickup completion separately from Distribution;
- remaining work;
- progress over time.

Every percentage needs an explicit denominator and unit.

Do not silently combine Street and House counts into one percentage without an accepted aggregation rule.

### Session measures
Candidate measures:
- number of outings/sessions;
- duration per session;
- participants per session;
- person-time;
- work completed per session;
- average/median session duration when meaningful;
- Areas requiring repeated outings.

### Map-linked statistics
Selecting a session or statistic may highlight its affected current Task geometry on the map.

This comes from Task/event relations, not GPS trails.

## Data-model direction

Potential future entities (names provisional):
- comments;
- activity_events / domain_events;
- field_sessions;
- field_session_task_events or event references;
- automation_rules;
- automation_runs;
- precomputed statistics/rollups only when scale proves a need.

Do not add all tables at once. Add only what the active plan requires with additive migrations.

## Retention / deletion

Before Team deletion/archive is implemented, define how session/activity/statistics history behaves.

Preferred direction:
- archive/tombstone Team identity when history must remain;
- historical session/event rows remain referentially understandable;
- permanent destructive deletion is explicit and narrow.

Long-term event/session/statistics retention requires an ADR before large-scale implementation.

## Organization interaction

Once Organizations exist:
- comments/events/sessions/statistics remain tenant-scoped;
- statistics require Organization/Campaign authorization;
- Admin panel may aggregate only within authorized Organization;
- automation rules are Campaign/Organization scoped only after scope model is explicit.

## Field UI boundary

Field UI:
- compact comments/activity access;
- session start/close/feedback UX;
- progress bar/percentage context;
- session history detail with optional map highlight;
- no giant analytics dashboard over the map.

Admin UI:
- richer history/filtering;
- statistics charts/tables;
- Area sizing/session analysis;
- automation configuration/failure review;
- audit views.

## Privacy

Do not infer exact walked/driven routes or productivity from continuous GPS.

Collect only explicit operational data needed by the product:
- Task/event changes;
- duration;
- participant count;
- optional note;
- authorized live-group/session state.

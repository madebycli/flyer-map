---
id: architecture-collaboration
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync]
source_of_truth_for: [future-comments, future-activity, future-automations, future-statistics, future-effort-feedback, future-collection-reporting]
---

# Collaboration, Activity, Automations and Statistics — Proposed

## Purpose

This document records constraints for future comments, activity history, automations, field feedback and statistics. These capabilities are planned but **not yet implemented**.

## Comments

Comments should attach to explicit domain context rather than becoming a free-floating social feed.

Candidate scopes:
- Campaign;
- Area;
- Task (Street/House/etc.);
- future collection/pickup stop.

Requirements:
- server-authorized read/write scope;
- timestamps and stable ids;
- operational actor label/reference;
- edit/delete policy defined before implementation;
- no unnecessary personal profile collection.

## Distribution completion / effort feedback

Groups should be able to record lightweight operational feedback while the information is still fresh instead of reconstructing it later from memory.

Initial fields/concepts:
- explicit Area/Street/session context;
- duration spent distributing;
- number of people involved;
- optional short note about difficulty, special circumstances or whether the Area sizing felt appropriate;
- timestamp;
- authorized actor/team context where useful.

This should be a dedicated domain record/event, not hidden inside a comment string and not inferred from GPS.

Primary product use:
- leaders can see how long an Area/Street actually took;
- group size is known instead of guessed in a later meeting;
- Areas that are repeatedly too large/small or unusually difficult can be identified;
- future statistics may derive person-time from explicitly entered duration × group size.

Exact session semantics, edit policy and whether feedback attaches to an Area, Task or separate field-session entity must be decided in the implementation slice.

## Activity history

Meaningful shared mutations should be representable as append-only activity events once the event model exists.

Candidate events:
- Area created/renamed/geometry changed;
- Task generated/created/status changed/deleted;
- Team/ownership changes;
- comment created;
- distribution completion feedback recorded/updated;
- future collection road/pickup-stop state changed;
- manually reported pickup address added;
- automation executed;
- access/admin changes where safe to expose.

Activity history should support auditability and progress statistics without requiring continuous GPS tracking.

## Automations

Automations are deterministic domain rules, not opaque background AI actions.

Initial candidates:
- new Area -> propose/generate road Tasks from reviewed OSM data;
- all building Tasks for a Street complete -> optionally complete the parent Street;
- status mutation -> append activity event;
- completion feedback recorded -> expose it to Area/Team reporting;
- all required pickup stops on a future collection segment complete -> optionally propose completing that segment;
- progress threshold -> surface a coordinator indicator;
- synchronization/retry state -> notify the user when manual action is required.

Requirements:
- every automation has an explicit trigger and effect;
- privileged effects run with explicit system/caller authorization rules;
- idempotency prevents duplicate effects;
- automation execution is observable/auditable;
- failed executions are visible rather than silently discarded;
- avoid high-frequency polling when event-driven/domain-triggered execution is enough.

## Statistics

Statistics are operational product metrics, not behavioral surveillance.

Initial measures:
- Task totals by status;
- completion percentage by Campaign / Team / Area;
- Street completion counts;
- building completion counts when House Mode exists;
- progress over time from activity/event timestamps;
- remaining work counts;
- optional automation/activity summaries useful to administrators;
- explicitly recorded distribution duration by Area/Street/session;
- explicitly recorded group size;
- derived person-minutes/person-hours where useful;
- historical Area effort comparisons to support better future Area sizing;
- future collection-mode counts for road sections and pickup addresses/stops.

Do not infer exact walked/driven routes, worker productivity or time-on-task from GPS because continuous GPS history is not part of the product baseline.

## Collection / pickup reporting interaction

The future Collection mode is a separate operational workflow from flyer distribution.

Collaboration/statistics implications:
- collection completion must not overwrite flyer-distribution completion;
- pickup addresses may be created from known House geometry or manually reported addresses, for example after a resident calls;
- comments/notes and activity should be attachable to a pickup stop;
- road-section completion and pickup-stop completion need explicit aggregation semantics before implementation;
- collection progress can later appear in statistics, but only from explicit domain state/events.

Do not reuse existing distribution statuses blindly for collection-only semantics. The collection model must be reviewed in its own implementation slice.

## Data-model direction

M5 mutation/event work should be designed so future activity/statistics can consume durable domain events without replaying arbitrary client snapshots.

Potential future entities (names not yet final):
- comments;
- activity_events / domain_events;
- distribution_sessions / completion_feedback;
- collection_routes / collection_segments;
- pickup_stops / pickup_addresses;
- automation_rules;
- automation_runs;
- precomputed statistics/rollups only when real scale demonstrates a need.

Do not add these tables until the corresponding implementation plan and migration are reviewed.

## Organization interaction

Once Organizations exist:
- comments, feedback and events remain tenant-scoped;
- statistics queries must require Organization/Campaign authorization;
- collection routes/stops remain Organization/Campaign-scoped;
- Admin panel may aggregate across Campaigns only within the caller's authorized Organization;
- automation rules may be Campaign- or Organization-scoped only after the scope model is explicit.

## UI boundary

Field UI:
- compact comments/activity access from relevant sheets;
- simple completion-feedback entry (duration, people, optional note) close to the moment a section is completed;
- future collection mode keeps open/completed road sections and pickup addresses clear on the map;
- no large analytics dashboard over the map;
- automation results appear as understandable state/messages.

Admin UI:
- richer activity/history views;
- statistics charts/tables;
- Area sizing/effort comparison;
- collection progress overview;
- automation configuration and failure review.

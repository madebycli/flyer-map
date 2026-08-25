---
id: architecture-collaboration
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-data, architecture-security, architecture-offline-sync]
source_of_truth_for: [future-comments, future-activity, future-automations, future-statistics]
---

# Collaboration, Activity, Automations and Statistics — Proposed

## Purpose

This document records constraints for future comments, activity history, automations and statistics. These capabilities are planned but **not yet implemented**.

## Comments

Comments should attach to explicit domain context rather than becoming a free-floating social feed.

Candidate scopes:
- Campaign;
- Area;
- Task (Street/House/etc.).

Requirements:
- server-authorized read/write scope;
- timestamps and stable ids;
- operational actor label/reference;
- edit/delete policy defined before implementation;
- no unnecessary personal profile collection.

## Activity history

Meaningful shared mutations should be representable as append-only activity events once the event model exists.

Candidate events:
- Area created/renamed/geometry changed;
- Task generated/created/status changed/deleted;
- Team/ownership changes;
- comment created;
- automation executed;
- access/admin changes where safe to expose.

Activity history should support auditability and progress statistics without requiring continuous GPS tracking.

## Automations

Automations are deterministic domain rules, not opaque background AI actions.

Initial candidates:
- new Area -> propose/generate road Tasks from reviewed OSM data;
- all building Tasks for a Street complete -> optionally complete the parent Street;
- status mutation -> append activity event;
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
- optional automation/activity summaries useful to administrators.

Do not infer exact walked routes or worker productivity from GPS because continuous GPS history is not part of the product baseline.

## Data-model direction

M5 mutation/event work should be designed so future activity/statistics can consume durable domain events without replaying arbitrary client snapshots.

Potential future entities (names not yet final):
- comments;
- activity_events / domain_events;
- automation_rules;
- automation_runs;
- precomputed statistics/rollups only when real scale demonstrates a need.

Do not add these tables until the corresponding implementation plan and migration are reviewed.

## Organization interaction

Once Organizations exist:
- comments and events remain tenant-scoped;
- statistics queries must require Organization/Campaign authorization;
- Admin panel may aggregate across Campaigns only within the caller's authorized Organization;
- automation rules may be Campaign- or Organization-scoped only after the scope model is explicit.

## UI boundary

Field UI:
- compact comments/activity access from relevant sheets;
- no large analytics dashboard over the map;
- automation results appear as understandable state/messages.

Admin UI:
- richer activity/history views;
- statistics charts/tables;
- automation configuration and failure review.

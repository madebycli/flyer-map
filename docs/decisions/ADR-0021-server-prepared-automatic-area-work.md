---
id: ADR-0021
type: decision
status: accepted
date: 2026-08-31
---

# ADR-0021: Server-prepared automatic Area work

## Status

Accepted. Persisted Distribution Areas may automatically produce real Street and House Tasks server-side from bounded OpenStreetMap data.

## Context

The existing Smart Street and Smart House product flows can load bounded OSM candidates in a browser. That makes candidate availability dependent on the current device and connectivity, while all users need the same durable distribution work after an Area is saved.

The product must keep app-owned Task identity, the existing M5 revision model and the normal DistributionTask/HouseTask domain. It must not introduce a second work-item domain, a new queue, or client-provided Overpass bounds/geometry for persistent generation.

## Decision

After a successful non-replayed `area.create` or `area.update-geometry` M5 mutation, the Worker schedules server-side Area preparation through `ExecutionContext.waitUntil`.

The job loads the canonical Area from D1, derives a canonical SHA-256 geometry hash, requests roads and buildings once through the existing bounded OSM normalizer, and creates ordinary persisted Tasks:

- every clipped road fragment becomes one normal Street Task with a new `task_<uuid>` id;
- each owned building becomes one normal House Task with a new `task_<uuid>` id and no automatic Street parent;
- OSM way ids remain only one-way source provenance;
- automatic rows carry a server-owned `areaPreparationGeneration`; manual rows remain null;
- the final deletion of prior automatic open work, insertion of new rows, ready state and Campaign revision claim are one guarded D1 batch.

The preparation state is keyed by `(campaign_id, area_id)`. Same-hash ready jobs are no-ops, fresh same-hash pending jobs deduplicate, and changed geometry/generation prevents an old job from publishing. Failed upstream or cap checks publish no task rows and do not advance the Campaign revision.

Road geometry is clipped exactly to the Area polygon before persistence. Building ownership uses a deterministic representative point in/on the building polygon and accepts it only when that point lies in/on the Area.

Automatic Task deletion is forbidden through ordinary client mutations. Their normal status changes remain available. Area geometry changes are forbidden after any automatic Street or House Task has left `open`; an Area delete continues to use the established foreign-key cascade.

The Worker exposes a narrow preparation status/retry route. Reads require access to the Area. Starts require Admin or the exact Area Team Editor. Viewers and field-group members cannot start preparation.

## Consequences

Benefits:

- all devices receive identical real Street/House work through normal snapshots;
- devices no longer need an Overpass request to use automatically prepared work;
- M5 remains the only user-mutation/brief-connectivity-loss protection path;
- manual and reviewed Smart Tasks remain normal compatible entities;
- no partial automatic publish can become visible.

Costs and boundaries:

- migration 0014 is prepared-only and must be explicitly rolled out before this path can run against remote D1;
- existing Areas are not mass-indexed during rollout;
- an upcoming UI slice must offer explicit preparation for an older editable Area;
- full offline maps remain an optional map-data feature, not the product goal for automatic Area work;
- a future reconciliation flow would need an explicit decision before replacing non-open automatic work.

## Alternatives rejected

- browser-side OSM preparation as durable truth: device/connectivity dependent and not authoritative;
- storing whole intersecting OSM ways: leaks geometry outside the Area and does not create correct work fragments;
- creating a parallel generated-work entity: duplicates status, snapshot and authorization semantics;
- one user mutation per generated Task: produces unnecessary revisions and weakens atomic publication.

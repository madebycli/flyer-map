---
id: ADR-0013
type: decision
status: proposed
date: 2026-08-26
---

# ADR-0013: Smart Street and House identity, source provenance and splitting

## Status

Proposed. No persistence/schema implementation is authorized by this ADR until the remaining product choice is resolved and the ADR is explicitly accepted.

## Context

M6 replaces rough hand-drawn Street geometry with reviewed OSM-derived road/building candidates while preserving the accepted website-only, MapLibre and M5 synchronization architecture.

ADR-0012 already requires normalized OSM source identity to survive into the prepared local package. Workbench slices currently prove that the app can:
- find OSM roads/buildings intersecting one Area;
- preserve `way/<osm id>` source identity and relevant inert tags;
- select one road source segment;
- expand selection through connected segments with the same normalized street name;
- select one or several building footprints;
- select addressed buildings belonging to one street.

The unresolved question is how those source objects become durable Verteil-Flyer domain Tasks.

Important constraints:
- OSM object ids are source provenance, not credentials;
- OSM ways may be split, merged, renamed or redrawn independently of Verteil-Flyer;
- manually created/fixed Streets or pickup addresses must remain possible even when no usable OSM object exists;
- queued/offline mutations require stable application-owned target ids;
- statistics need an explicit user-visible Street/House denominator;
- future Field Session history must be able to reference durable Task ids rather than transient map-query results;
- distribution and pickup completion remain independent;
- geometry stored by the Campaign must remain usable if a later OSM refresh changes the source dataset.

## Decision candidate: application-owned Task identity with explicit OSM provenance

### Street identity

A durable Smart Street Task should receive a normal application-owned generated Task id.

The Task stores a reviewed geometry snapshot and separate source provenance such as:

```text
StreetTask
- id: task_<uuid>
- campaignId
- areaId
- label
- geometry: LineString or MultiLineString
- status
- source:
  - dataset: OpenStreetMap
  - objectType: way
  - objectIds: [101, 102, ...]
  - packageFetchedAt / sourceTimestamp when useful
- createdAt / updatedAt
```

`source.objectIds` are metadata for traceability, refresh comparison and later re-generation assistance. They are never the durable Task id.

One user-visible Street Task may reference multiple OSM ways when the user deliberately selects them as one logical Street/section.

### House identity

A durable House Task should also receive an application-owned generated id and store its reviewed geometry/address snapshot separately from optional source provenance:

```text
HouseTask
- id: task_<uuid>
- campaignId
- areaId
- optional parentStreetTaskId
- address/display label
- building geometry or reviewed point/footprint
- distribution status
- optional source:
  - dataset: OpenStreetMap
  - objectType: way
  - objectId
```

Manual House/Pickup addresses may have `source = null`.

### Why geometry is snapshotted

After Task creation, Campaign behavior must not depend on the next OSM response reproducing exactly the same object geometry or identity. A later prepared-package refresh may propose changes, but it must not silently rewrite completed/assigned domain Tasks.

Any future source-refresh/reconciliation feature must be explicit and reviewable.

## Remaining product choice: default Smart Street click scope

Two workbench-tested behaviors remain possible:

### Option S1: clicked source segment

A click starts with only the clicked OSM way.

Benefits:
- precise and predictable;
- easy to split work into small sections;
- unnamed roads behave naturally.

Trade-offs:
- many real streets consist of multiple OSM ways;
- user may need several taps to mark what they perceive as one street;
- progress may become too fragmented if every source way becomes a separate user-visible Task.

### Option S2: connected same-name street

A click expands through touching OSM ways with the same normalized street name inside the Area candidate set.

Benefits:
- closer to the user concept of “mark the whole street”;
- avoids requiring knowledge of OSM way boundaries;
- fewer user-visible Street Tasks.

Trade-offs:
- unnamed roads cannot safely auto-group;
- named roads may branch or have unusual topology;
- the UI must preview exactly what will be selected before saving;
- disconnected same-name pieces must not be silently included.

A visual workbench prototype exists for comparing S1/S2. The default remains unresolved in this proposed ADR.

## Splitting and combining direction

Regardless of S1/S2:
- source ways are inputs, not immutable domain boundaries;
- user-visible Street Tasks may be created from one or multiple selected source ways;
- combining selected source ways produces one new application-owned Street Task with all reviewed source ids recorded;
- future manual splitting creates application-owned Tasks for the resulting reviewed pieces instead of reusing fabricated OSM ids;
- a split/merge operation must be atomic from the Campaign snapshot/mutation perspective;
- once long-term activity/session history exists, replacement/supersession semantics must preserve historical references rather than hard-deleting history.

Exact historical supersession storage belongs with the event/session retention ADR, not this M6 ADR.

## Rejected: OSM id as Task id

Do not use `way/12345` directly as the durable Verteil-Flyer Task id.

Reasons:
- OSM ways can be split/merged;
- one user-visible street may require multiple OSM ways;
- manual tasks have no OSM id;
- application identity becomes coupled to an external mutable dataset;
- offline mutation targets and future history become unnecessarily fragile.

## Rejected: normalized street name as Task id

Do not derive Task identity from Area + street name.

Reasons:
- duplicate street names can exist;
- roads can be unnamed or renamed;
- one named street may intentionally be split into several work sections;
- string normalization is display/grouping logic, not durable identity.

## Rejected: geometry hash as primary identity

A geometry hash may help compare source revisions but must not be the Task id because harmless geometry changes would replace identity and break references.

## Security and trust boundaries

- OSM names/refs/address tags remain untrusted inert text;
- source ids are selectors/provenance, never credentials;
- any future persistence uses validated structured payloads and parameterized/prepared D1 statements;
- Worker authorization remains authoritative for Task creation/update;
- generated domain ids are validated independently of source ids;
- no user-supplied Overpass/query text is introduced by M6.

## Consequences if accepted

Benefits:
- durable offline-safe Task targets;
- OSM refreshes cannot silently destroy Campaign identity;
- supports one-segment, whole-street and manual geometry workflows;
- House and later Pickup tasks can share source provenance without sharing completion status;
- future sessions/comments/statistics can reference stable Task ids.

Costs:
- schema/mutation contracts must add source provenance and House-capable Task shape;
- MultiLineString or equivalent logical-street geometry may be required when one Street Task aggregates source ways;
- source refresh becomes a reconciliation problem instead of an automatic overwrite.

## Acceptance required before M6 persistence

Before implementing the D1/schema/mutation write path:
1. choose S1 or S2 as the default click behavior;
2. confirm application-owned generated ids + separate OSM provenance;
3. define the initial persisted Street geometry representation for multi-way selections;
4. update DATA/MAP/OFFLINE_SYNC/SECURITY docs and mutation tests;
5. use additive migration only for the active M6 slice.

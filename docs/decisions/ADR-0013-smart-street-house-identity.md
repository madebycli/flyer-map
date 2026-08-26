---
id: ADR-0013
type: decision
status: accepted
date: 2026-08-26
---

# ADR-0013: Smart Street and House identity, source provenance and detailed section selection

## Status

Accepted on 2026-08-26. The product owner explicitly confirmed application-owned Task ids with separate OSM provenance and persisted reviewed geometry snapshots. M6 persistence may proceed under the constraints in this ADR.

## Context

M6 replaces rough hand-drawn Street geometry with reviewed OSM-derived road/building candidates while preserving the accepted website-only, MapLibre and M5 synchronization architecture.

ADR-0012 already requires normalized OSM source identity to survive into the prepared local package. Workbench slices currently prove that the app can:
- find OSM roads/buildings intersecting one Area;
- preserve `way/<osm id>` source identity and relevant inert tags;
- select one or several building footprints;
- select addressed buildings belonging to one street;
- treat OSM road source ways as small selectable source sections rather than user-visible whole-street identities;
- resolve a unique connected range between start/end anchors;
- enumerate bounded route candidates when a junction/loop offers multiple paths;
- resolve ambiguous ranges through explicit waypoint anchors.

The product goal is deliberately detailed selection. A user chooses the beginning and end of the desired road section on the map. The app selects the connected road source sections between those anchors. It must not select every OSM way sharing a street name and must not continue for kilometers merely because the road name is unchanged.

Important constraints:
- OSM object ids are source provenance, not credentials;
- OSM ways may be split, merged, renamed or redrawn independently of Verteil-Flyer;
- manually created/fixed Streets or pickup addresses must remain possible even when no usable OSM object exists;
- queued/offline mutations require stable application-owned target ids;
- statistics need an explicit user-visible Street/House denominator;
- future Field Session history must be able to reference durable Task ids rather than transient map-query results;
- distribution and pickup completion remain independent;
- geometry stored by the Campaign must remain usable if a later OSM refresh changes the source dataset.

## Decision: application-owned Task identity with explicit OSM provenance

### Street identity

A durable Smart Street Task receives a normal application-owned generated Task id.

The Task stores a reviewed geometry snapshot and separate source provenance such as:

```text
StreetTask
- id: task_<uuid>
- campaignId
- areaId
- label
- geometry: reviewed GeoJSON LineString road-section snapshot
- status
- source:
  - dataset: OpenStreetMap
  - objectType: way
  - objectIds: [101, 102, ...]
  - packageFetchedAt / sourceTimestamp when useful
- createdAt / updatedAt
```

`source.objectIds` are metadata for traceability, refresh comparison and later re-generation assistance. They are never the durable Task id.

One user-visible Street Task may reference multiple OSM ways when the user deliberately selects a start/end section spanning several source ways.

### House identity

A durable House Task also receives an application-owned generated id and stores its reviewed geometry/address snapshot separately from optional source provenance:

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

## Persisted Street geometry representation

The initial persisted Smart Street geometry is a reviewed GeoJSON-compatible `LineString` snapshot using `[longitude, latitude]` coordinates.

Rules:
- the persisted LineString represents exactly the user-reviewed route between the snapped start and end anchors;
- the first and last source road sections are clipped at the snapped anchor coordinates, so geometry outside the selected range is not stored as part of the Task;
- when start and end are on the same source road section, only the interval between those two snapped anchors is stored;
- when a selected route spans multiple OSM ways, their reviewed source geometries are ordered, oriented and stitched into one continuous LineString;
- source coordinate order may be reversed during stitching when required for continuity. This does not change OSM provenance;
- OSM way ids remain separate provenance metadata and do not determine domain identity;
- adjacent duplicate coordinates are removed while building the snapshot;
- the persisted snapshot is copied into Campaign-owned data and is not a live reference to the prepared OSM package;
- if the reviewed route cannot be validated as one continuous LineString, persistence must fail visibly and require correction. The initial format does not silently fall back to a `MultiLineString`;
- a later OSM/package refresh may propose differences, but it must never silently rewrite an existing Task geometry snapshot or Task id.

A future explicit reconciliation flow may compare the snapshot with newer source data, but accepting such a change is a separate user-visible operation.

## Why geometry is snapshotted

After Task creation, Campaign behavior must not depend on the next OSM response reproducing exactly the same object geometry or identity. A later prepared-package refresh may propose changes, but it must not silently rewrite completed/assigned domain Tasks.

Any future source-refresh/reconciliation feature must be explicit and reviewable.

## Confirmed product direction: detailed anchor-to-anchor Street selection

The previous workbench alternatives "clicked OSM segment" and "connected same-name street" are superseded as the default product model.

The intended interaction is:
1. user enters Smart Street selection mode;
2. user clicks/taps a start location/road section;
3. user clicks/taps an end location/road section;
4. the app highlights only the connected road source sections between the two anchors;
5. user reviews the highlighted section before creating/saving a Street Task.

Rules:
- street name is display metadata only and never determines how far selection expands;
- crossing from one named road into another is allowed when that is the explicitly selected connected path;
- a long same-name road is not selected beyond the chosen end anchor;
- the existing click-oriented map interaction remains the basis, but clicks choose reviewed OSM road geometry instead of drawing a rough marker line;
- selecting start and end on the same source section produces one detailed section candidate;
- disconnected anchors must fail visibly rather than fabricating a connection.

## Confirmed junction UX: route candidates plus waypoints (Option C)

When more than one topological path exists between start and end, the app must not guess.

Selected product behavior:
- for a simple ambiguity, show a small bounded set of concrete route candidates so the user can tap the intended route;
- also allow one or more intermediate waypoint clicks to force a precise route through complicated junctions;
- route candidates are previews only and never become selected until the user chooses one;
- if the graph search is too complex/bounded to prove uniqueness, treat it as ambiguous rather than silently choosing a path;
- adding waypoints divides the range into legs, and every leg must resolve unambiguously before saving;
- the user can reset/correct start, end and waypoints before creating the Task.

The current workbench helper exposes both route options and waypoint resolution without persistence.

## Splitting and combining direction

- source ways are inputs, not immutable domain boundaries;
- user-visible Street Tasks may be created from one or multiple selected source ways;
- start/end selection creates one application-owned Street Task from the reviewed selected section;
- future manual splitting creates application-owned Tasks for resulting reviewed pieces instead of reusing fabricated OSM ids;
- a split/merge operation must be atomic from the Campaign snapshot/mutation perspective;
- once long-term activity/session history exists, replacement/supersession semantics must preserve historical references rather than hard-deleting history.

Exact historical supersession storage belongs with the event/session retention ADR, not this M6 ADR.

## Rejected: select by normalized street name

Do not expand selection because source sections have the same normalized road name.

Reasons:
- one named street can run through an entire village or for many kilometers;
- the requested workflow is detailed beginning/end selection;
- duplicate/branched street naming is not a reliable geometry boundary;
- unnamed roads still need to be selectable;
- street name remains useful as a label, not topology authority.

## Rejected: OSM id as Task id

Do not use `way/12345` directly as the durable Verteil-Flyer Task id.

Reasons:
- OSM ways can be split/merged;
- one user-selected section may require multiple OSM ways;
- manual tasks have no OSM id;
- application identity becomes coupled to an external mutable dataset;
- offline mutation targets and future history become unnecessarily fragile.

## Rejected: geometry hash as primary identity

A geometry hash may help compare source revisions but must not be the Task id because harmless geometry changes would replace identity and break references.

## Security and trust boundaries

- OSM names/refs/address tags remain untrusted inert text;
- source ids are selectors/provenance, never credentials;
- any persistence uses validated structured payloads and parameterized/prepared D1 statements;
- Worker authorization remains authoritative for Task creation/update;
- generated domain ids are validated independently of source ids;
- no user-supplied Overpass/query text is introduced by M6.

## Consequences

Benefits:
- precise road-section selection matching the field workflow;
- no accidental multi-kilometer selection from shared street names;
- complex junctions remain controllable without opaque route guessing;
- durable offline-safe Task targets;
- OSM refreshes cannot silently destroy Campaign identity;
- future sessions/comments/statistics can reference stable Task ids.

Costs:
- the UI needs start/end/waypoint state and route-candidate preview;
- road graph connectivity must be derived from reviewed OSM source geometry;
- schema/mutation contracts must add source provenance and House-capable Task shape;
- source refresh becomes a reconciliation problem instead of an automatic overwrite.

## Implementation requirements for M6 persistence

1. Keep application-owned Task ids independent from OSM ids and geometry hashes.
2. Persist the validated reviewed LineString snapshot plus separate OSM provenance.
3. Update DATA/MAP/OFFLINE_SYNC/SECURITY documentation and add mutation/persistence regression tests before promoting the runtime slice.
4. Use additive migrations only for the active M6 slice.
5. Preserve existing server-side authorization, validation and prepared/parameterized SQL boundaries.

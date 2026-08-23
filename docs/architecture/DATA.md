---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture-security, architecture-offline-sync]
source_of_truth_for: [domain-data-model]
---

# Data Model

## Browser snapshot

The browser uses the same campaign/team/area/task domain shape that the Worker/D1 API is expected to expose later.

Snapshot schema v2 contains:
- `schemaVersion`
- `revision`
- one campaign
- campaign teams
- campaign areas
- distribution tasks

`revision` increments for every local domain mutation. It is intentionally part of the transport/domain model so a later Worker can expose campaign version checks for simple polling and conflict detection without redesigning client state.

The M2 client migrates the existing M1 schema-v1 snapshot to schema v2 by preserving campaign, teams and areas and adding an empty task collection. The current local storage key is stable; the previous M1 key is read as a legacy fallback and removed only after the migrated snapshot has been saved successfully.

Browser persistence is still local-only. It is not shared synchronization. Shared multi-device state still requires the Worker/D1 slice.

## Entities

### Campaign

One flyer distribution effort.

Fields: id, name, status, revision, created_at, updated_at.

### Team

Named group within a campaign.

Fields: id, campaign_id, name, color, created_at, updated_at.

Within one campaign, active UI team colors are unique so ownership remains visually distinguishable.

### Area

Geographic assignment owned by exactly one team.

Fields: id, campaign_id, team_id, name, geometry, created_at, updated_at.

Geometry is a GeoJSON Polygon. Browser code validates minimum vertices, duplicate/degenerate points and self-intersection before a polygon is saved.

### Task

One unit that can be marked during distribution.

M2 implements the first task type: `street`.

Fields: id, campaign_id, area_id, task_type, label, geometry, status, completed_at, created_at, updated_at.

Street geometry is a GeoJSON LineString manually traced over the basemap and assigned to one area. At least two distinct valid map points are required before save.

Future OSM/source metadata fields may be populated when bounded import is introduced; the current manual Street Mode does not depend on upstream road identifiers.

Geometry is planned to be stored as GeoJSON-compatible JSON text in D1. Introduce spatial infrastructure only if real server-side geographic queries require it.

## Status vocabulary

- open
- completed
- later
- not-deliverable

`completed_at` is set when a task enters `completed` and cleared when it leaves that state.

## IDs

Use opaque application IDs. The current browser slice uses `crypto.randomUUID()` with entity prefixes. Do not expose sequential database IDs as authorization secrets.

## Revision/version direction

The campaign revision is a coarse synchronization primitive, not authorization and not a complete conflict strategy.

A later Worker/D1 implementation may:
1. return the current campaign revision with the campaign snapshot;
2. expose a lightweight version endpoint for polling;
3. require clients to submit the version they edited from;
4. reject or explicitly reconcile stale writes instead of silently applying last-write-wins.

The exact conflict policy belongs to the synchronization milestone.

## Event history

An append-only task event table is expected before production hardening so accidental or conflicting state changes are diagnosable. It is intentionally not included in the first schema until synchronization semantics are designed.

## Migration source

SQL migrations under `/migrations` are the schema source of truth once D1 is enabled.

The current initial migration is still only a proposal because no production D1 binding exists. Do not invent a database id.

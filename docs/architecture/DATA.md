---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-08-24
related: [architecture-security, architecture-offline-sync]
source_of_truth_for: [domain-data-model]
---

# Data Model

## M1 browser snapshot

The first real product slice uses the same campaign/team/area domain shape in the browser that the Worker/D1 API is expected to expose later.

The browser snapshot contains:
- `schemaVersion`
- `revision`
- one campaign
- the campaign teams
- the campaign areas

`revision` increments for every local domain mutation. It is intentionally part of the transport/domain model now so a later Worker can expose campaign version checks for simple polling and conflict detection without redesigning the client state shape.

M1 persists this snapshot in browser `localStorage` so a single phone survives reloads. This is not shared persistence and must not be described as synchronization. Shared multi-device state still requires the Worker/D1 slice.

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

Geometry is planned to be stored as GeoJSON-compatible JSON text in D1. Introduce spatial infrastructure only if real server-side geographic queries require it.

### Task

One unit that can be marked during distribution.

Fields: id, campaign_id, area_id, task_type, label, geometry, source metadata, status, completed_at, updated_at.

## Status vocabulary

- open
- completed
- later
- not-deliverable

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

No production D1 database is currently bound. Do not invent a database id.

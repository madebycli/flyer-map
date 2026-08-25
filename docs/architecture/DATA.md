---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-security, architecture-offline-sync, product-roadmap, ADR-0009]
source_of_truth_for: [domain-data-model, d1-baseline]
---

# Data Model

## Current shared snapshot

Browser and Worker currently use Campaign snapshot schema v3:
- `schemaVersion: 3`;
- shared `revision`;
- one Campaign;
- Campaign Teams;
- Campaign Areas;
- Distribution Tasks.

D1 is the persisted shared source of truth. localStorage remains a startup/last-known cache and conflict safety copy. Existing older local snapshots are migrated in-browser rather than deleted.

## Current entities

### Campaign

One distribution effort.

Fields:
- id;
- name;
- status;
- `defaultMapView` or null;
- createdAt;
- updatedAt.

The shared snapshot carries Campaign revision at top level.

### Team

Named group inside one Campaign.

Fields:
- id;
- campaignId;
- name;
- color;
- createdAt;
- updatedAt.

### Area

Geographic assignment owned by exactly one Team in the same Campaign.

Fields:
- id;
- campaignId;
- teamId;
- name;
- Polygon geometry;
- timestamps.

Client and Worker validate usable Polygon geometry.

### Task

One distribution unit. The **current implemented task type is `street`**.

Fields:
- id;
- campaignId;
- areaId;
- taskType;
- label;
- LineString geometry;
- status;
- completedAt;
- timestamps.

Current Street Tasks may be manually traced, but M6 plans reviewed road/building data so manual tracing is no longer the normal workflow.

Future House Tasks / parent-child Street-House relationships require an explicit schema plan and additive migration; they are not silently implied by current `street` rows.

## Status vocabulary

- open
- completed
- later
- not-deliverable

`completedAt` is set for completed Tasks and null otherwise.

## IDs and authorization selectors

Domain ids are opaque application ids. Browser-created entities use UUID-based ids.

`?campaign=` and route ids are selectors only. Authorization always comes from access/session credentials and Worker scope checks.

## D1 production migration history

Applied migrations are immutable history:
- `migrations/0001_initial.sql` — Campaign/Team/Area/Task baseline;
- `migrations/0002_m4_access.sql` — shared map focus + access grant/session tables.

Future schema work must use new additive migrations (`0003_...`, etc.).

## Current tables

Domain tables:
- `campaigns`;
- `teams`;
- `areas`;
- `tasks`.

Access tables:
- `campaign_access_grants`;
- `campaign_sessions`.

Plaintext access/session secrets are never stored in D1; only SHA-256 hashes are persisted.

## Important Team Editor grant rule

`campaign_access_grants.team_id` scopes a Team Editor grant, but **there is intentionally no D1 foreign key from the grant to the `teams` table**.

Reason: current complete-snapshot persistence replaces Team child rows during a snapshot write. A Team foreign key with cascading behavior could revoke valid Team Editor grants merely because a snapshot replacement temporarily deletes/reinserts Team rows.

Instead:
- grant creation verifies that the Team exists in the Campaign;
- access resolution verifies that a Team Editor's scoped Team still exists;
- if the Team no longer exists, that scoped access is treated as invalid;
- Campaign/grant/session foreign keys still enforce Campaign ownership where safe.

Do not reintroduce a Team FK without redesigning snapshot replacement semantics.

## Current revision/write semantics

Current M4 persistence still uses coarse complete-snapshot replacement with one Campaign revision.

Protected endpoints include:
- snapshot read;
- version read;
- snapshot write.

Rules:
- valid Campaign-scoped session required;
- Viewer cannot write;
- Team Editor complete-snapshot proposal is diff-authorized server-side;
- stale base revision returns conflict rather than silent overwrite;
- new Campaign creation is a dedicated flow;
- legacy ownership bootstrap/recovery is explicit and protected.

## M5 transition direction

M5 is planned to introduce durable mutation/idempotency semantics while retaining the snapshot as startup/recovery state.

Expected direction:
- IndexedDB pending mutation queue;
- stable mutation/idempotency ids;
- narrower Worker mutation endpoints;
- server-side applied-mutation tracking;
- explicit conflicts;
- append-only domain/event information that later Activity/Statistics can consume.

Do not delete legacy/local state during this transition.

## Future organization model

M8 plans an Organization tenant above Campaigns. It is not part of the current schema.

Requirements for future migration:
- existing Campaigns preserved;
- additive D1 migration;
- no first-visitor claim race;
- explicit organization authorization/membership;
- no cross-organization relationships.

See `docs/architecture/ORGANIZATIONS.md`.

## Future collaboration/statistics data

Comments, activity/domain events, automation rules/runs and statistics rollups are planned but not current tables.

Prefer deriving statistics from durable state/events. Do not add continuous GPS history for analytics.

See `docs/architecture/COLLABORATION.md`.

## Browser-only data

Intentionally local unless later changed:
- language preference;
- personal last map camera per Campaign;
- planned UI light/dark/system preference;
- active unsaved draw/edit draft;
- GPS route history (none exists).

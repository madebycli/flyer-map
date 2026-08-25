---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-security, architecture-offline-sync, product-roadmap, ADR-0009, ADR-0011]
source_of_truth_for: [domain-data-model, d1-baseline]
---

# Data Model

## Shared snapshot

Browser and Worker use Campaign snapshot schema v3:
- `schemaVersion: 3`;
- shared `revision`;
- one Campaign;
- Campaign Teams;
- Campaign Areas;
- Distribution Tasks.

D1 is the persisted shared source of truth. localStorage remains startup/last-known cache and conflict safety copy. Existing older local snapshots are migrated in-browser rather than deleted.

M5 keeps the snapshot model for reads/UI while changing **new ordinary write delivery** from coarse snapshot replacement to explicit queued mutations.

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

M5 mutation ids use UUID-backed `mutation_...` identifiers and are stable across retries. They are idempotency keys, not credentials.

## D1 migration history / rollout

Applied production history remains immutable:
- `migrations/0001_initial.sql` — Campaign/Team/Area/Task baseline;
- `migrations/0002_m4_access.sql` — shared map focus + access grant/session tables.

M5 PR #24 adds:
- `migrations/0003_m5_mutations.sql` — Campaign-scoped mutation idempotency ledger.

`0003` is repository-prepared but must not be described as applied to Production until the explicit D1 migration action succeeds. The M5 mutation endpoint depends on this table and must not be exercised in an environment before the migration is applied there.

## Tables after M5 migration

Domain tables:
- `campaigns`;
- `teams`;
- `areas`;
- `tasks`.

Access tables:
- `campaign_access_grants`;
- `campaign_sessions`.

M5 ledger:
- `campaign_mutations`.

`campaign_mutations` records:
- Campaign id;
- mutation id;
- mutation type;
- requested client base revision;
- server revision from which it was applied;
- resulting applied revision;
- client creation time;
- server applied time.

Primary key:
- `(campaign_id, mutation_id)`.

The ledger is for idempotency/auditability of mutation application. It is not an authorization credential and does not contain plaintext access/session secrets.

Plaintext access/session secrets are never stored in D1; only SHA-256 hashes are persisted.

## Important Team Editor grant rule

`campaign_access_grants.team_id` scopes a Team Editor grant, but there is intentionally no D1 foreign key from the grant to the `teams` table.

The legacy snapshot replacement path still exists during M5 transition and can delete/reinsert Team rows. A Team foreign key with cascading behavior could therefore revoke valid Team Editor grants during that compatibility write.

Instead:
- grant creation verifies that the Team exists in the Campaign;
- access resolution verifies that a Team Editor's scoped Team still exists;
- if the Team no longer exists, that scoped access is invalid;
- Campaign/grant/session foreign keys still enforce Campaign ownership where safe.

Do not reintroduce a Team FK until legacy snapshot replacement is removed/redesigned and an explicit migration is accepted.

## Revision/write semantics

### Reads

Protected read model remains snapshot-based:
- snapshot read;
- lightweight version read.

The Campaign revision is still the shared monotonic revision used to detect newer canonical state.

### Legacy snapshot write

Authorized complete-snapshot PUT remains during M5 only as:
- compatibility for pre-M5 optimistic local state;
- transition/recovery path.

It remains revision-checked and Worker-authorized. New ordinary M5 saves must not use it as their normal delivery path.

### M5 mutation write

Protected endpoint:
- `POST /api/campaigns/:id/mutations`.

For a new mutation the Worker:
1. validates the mutation;
2. loads current snapshot;
3. applies the mutation in memory with target-specific conflict preconditions;
4. validates the resulting snapshot;
5. authorizes current/candidate snapshots using the existing Worker policy;
6. attempts a narrow row change and ledger insert guarded by current Campaign revision + internal `write_token`.

The D1 batch contains:
- Campaign revision/write-token claim;
- exactly the affected narrow domain statement;
- mutation ledger insert.

If the revision claim loses a race, the Worker reloads/re-evaluates for a bounded number of attempts. If the target remains compatible, the mutation can apply on the newer revision. If the target changed, an explicit conflict is returned.

If `(campaign_id, mutation_id)` already exists, the server returns its prior applied revision without applying the domain effect again.

## Client durable queue data

IndexedDB stores unacknowledged mutation records while localStorage continues to store the latest snapshot cache.

Queue records are browser-local and include mutation payload, state, attempts/retry timing and last error. They are not synchronized as a separate server entity; successful server acknowledgement removes the queue record.

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
- M5 IndexedDB queue until its mutations are acknowledged;
- GPS route history (none exists).

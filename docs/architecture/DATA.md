---
id: architecture-data
type: architecture
status: accepted
last_updated: 2026-09-01
related: [architecture-security, architecture-offline-sync, product-roadmap, ADR-0009, ADR-0011, ADR-0013, ADR-0021, ADR-0022]
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
- Street Distribution Tasks in `tasks`;
- optional M6 House Tasks in `houseTasks`.

`houseTasks` is an additive schema-v3 extension. Older snapshots may omit it and are interpreted as having no House Tasks.

D1 is the persisted shared source of truth. localStorage remains startup/last-known cache and conflict safety copy. Existing older local snapshots are migrated in-browser rather than deleted.

M5 keeps the snapshot model for reads/UI, startup cache and conflict safety copies. New ordinary write delivery uses explicit queued mutations, not a complete snapshot replacement.

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

### Street Task

One street distribution unit.

Fields:
- application-owned id;
- campaignId;
- areaId;
- `taskType: street`;
- label;
- reviewed LineString geometry snapshot;
- optional external source provenance;
- optional server-owned `areaPreparationGeneration`;
- status;
- completedAt;
- timestamps.

Manual Street Tasks remain valid without source provenance.

`areaPreparationGeneration` is null for manual and user-reviewed Smart Tasks. A non-null UUID identifies a server-prepared automatic Task generation and is not client-controlled.

Under accepted ADR-0013, a Smart Street Task keeps its durable application id separate from OSM. The reviewed selected route is copied into Task `geometry` as a Campaign-owned LineString snapshot. Optional `source` provenance is restricted to reviewed metadata such as:
- `dataset: OpenStreetMap`;
- `objectType: way`;
- ordered OSM `objectIds` used by the selected route.

OSM ids never become Task ids. A later OSM/package refresh must not silently rewrite a Task id or its reviewed geometry/provenance.

### House Task

M6 House persistence uses a separate additive House collection/table so the established Street renderer and Street progress denominator remain stable.

Fields:
- application-owned `task_<uuid>` style id;
- campaignId;
- areaId;
- `taskType: house`;
- address/display label;
- reviewed Polygon building geometry snapshot;
- optional OSM source provenance;
- optional `parentStreetTaskId`;
- optional server-owned `areaPreparationGeneration`;
- status;
- completedAt;
- timestamps.

For OSM-backed House Tasks, provenance is exactly one positive Way id. It remains metadata only. `parentStreetTaskId`, when present, must resolve to a Street Task in the same Campaign and Area.

Reviewed House geometry, source provenance and parent relation are immutable through ordinary writes. A future source-reconciliation feature must use an explicit reviewed mutation rather than silently accepting changed upstream OSM geometry.

Deleting a parent Street clears the optional House-parent relationship rather than deleting the House Task. Deleting an Area cascades its Street and House Tasks.

### Automatic Area preparation

ADR-0021 adds a prepared-only server job that turns the canonical persisted Area geometry into ordinary open Street and House Tasks. It does not create a parallel work-item type.

- `area_task_preparations` is keyed by `(campaign_id, area_id)` and records the current geometry hash, generation, `pending` / `ready` / `failed` status, counts, timestamps and a non-secret error code;
- automatic Tasks retain normal application-owned ids, Task status and OSM provenance, but carry the server-created generation UUID;
- the browser reads those Tasks through the ordinary Campaign snapshot; omitted legacy fields deserialize as null;
- manual Tasks have null generation and are never replaced by a preparation run;
- ordinary client mutations may change an automatic Task's status but may not delete or rewrite its automatic identity.

## Status vocabulary

Street and House Tasks share:
- open
- completed
- later
- not-deliverable

`completedAt` is set for completed Tasks and null otherwise.

## IDs and authorization selectors

Domain ids are opaque application ids. Browser-created entities use UUID-based ids.

ADR-0013 explicitly confirms that new Smart Street/House Tasks use application-owned generated ids. External OSM ids are provenance only.

Street and House Task ids are required to be unique inside one Campaign snapshot even though the current additive D1 rollout uses separate physical tables.

`?campaign=` and route ids are selectors only. Authorization always comes from access/session credentials and Worker scope checks.

M5 mutation ids use UUID-backed `mutation_...` identifiers and are stable across retries. They are idempotency keys, not credentials.

Each validated M5 mutation is canonicalized with deterministic object-key ordering and hashed with SHA-256. The resulting lowercase 64-character fingerprint binds the idempotency id to the mutation content.

## D1 migration history / rollout

Applied remote D1 history remains immutable:
- `migrations/0001_initial.sql` - Campaign/Team/Area/Street Task baseline;
- `migrations/0002_m4_access.sql` - shared map focus + access grant/session tables;
- `migrations/0003_m5_mutations.sql` - Campaign-scoped mutation idempotency ledger, applied successfully to remote `flyer-map-db` on 2026-08-25.

Prepared code adds, but has **not remotely applied**:
- `migrations/0004_m6_task_source_provenance.sql` - nullable `tasks.source_json` for external Street Task provenance;
- `migrations/0005_m6_house_tasks.sql` - additive durable House Task table.
- `migrations/0014_auto_area_task_preparation.sql` - automatic Task generation/state columns and `area_task_preparations`.

These migrations are intentionally additive. Existing/manual Street rows remain valid before them. Application code must not mark any migration production-applied until an explicit rollout and acceptance step is performed.

Pre-migration behavior is fail-safe:
- before 0004, manual Street writes remain compatible while Smart Street provenance writes return `schema_migration_required`;
- before 0005, Street reads/writes remain compatible while any durable House write returns `schema_migration_required` before the Campaign revision is claimed;
- before 0014, automatic Area preparation and its status route fail closed with `area_preparation_schema_unavailable`; existing manual/M5 work remains compatible;
- House data is never silently dropped or coerced into the Street table.

Do not rewrite historical migrations.

## Tables

Established domain tables:
- `campaigns`;
- `teams`;
- `areas`;
- `tasks` for Street Tasks.

After migration 0005:
- `house_tasks` for House Tasks.

After migration 0014:
- `area_task_preparations` for automatic Area preparation state;
- nullable `area_preparation_generation` columns on `tasks` and `house_tasks`.

Access tables:
- `campaign_access_grants`;
- `campaign_sessions`.

M5 ledger:
- `campaign_mutations`.

`house_tasks` contains Campaign/Area scope, optional Street parent, reviewed Polygon JSON, optional source JSON, Task status and timestamps. The parent FK uses `ON DELETE SET NULL`; Worker validation additionally enforces same-Campaign/same-Area semantics that the single-column FK alone cannot express.

`campaign_mutations` records:
- Campaign id;
- mutation id;
- mutation type;
- canonical mutation SHA-256 fingerprint;
- requested client base revision;
- server revision from which it was applied;
- resulting applied revision;
- client creation time;
- server applied time.

Primary key:
- `(campaign_id, mutation_id)`.

`mutation_fingerprint` is required and constrained to 64 characters. It distinguishes a genuine duplicate retry from accidental/malicious reuse of the same mutation id with changed content.

The ledger is for idempotency/auditability of mutation application. It is not an authorization credential and does not contain plaintext access/session secrets.

Plaintext access/session secrets are never stored in D1; only SHA-256 hashes are persisted.

## Important Team Editor grant rule

`campaign_access_grants.team_id` scopes a Team Editor grant, but there is intentionally no D1 foreign key from the grant to the `teams` table.

The absence of a D1 foreign key from a Team Editor grant to `teams` is a historical choice from migration 0002. The old snapshot replacement could delete/reinsert Team rows, so adding a cascading FK without an explicit migration would have been unsafe. This M5 slice removes that replacement path but does not rewrite the historical schema.

The existing safeguards remain:
- grant creation verifies that the Team exists in the Campaign;
- access resolution verifies that a Team Editor's scoped Team still exists;
- if the Team no longer exists, that scoped access is invalid;
- Campaign/grant/session foreign keys still enforce Campaign ownership where safe.

Do not add a Team FK implicitly. Any future FK or Team-lifecycle change requires its own explicit migration and decision.

## Revision/write semantics

### Reads

Protected read model remains snapshot-based:
- snapshot read;
- lightweight version read.

The Campaign revision is still the shared monotonic revision used to detect newer canonical state.

When 0005 exists, the Worker loads `house_tasks` into optional `CampaignSnapshot.houseTasks`. Before 0005, it does not query a missing House table and returns the established Street snapshot shape.

### Initial Campaign create

`POST /api/campaigns` is the one-time server-side bootstrap for a new Campaign. The Worker validates a schema-v3 snapshot with `revision: 0` and calls `createInitialCampaignState`.

The repository claims the new Campaign with an atomic insert-only D1 batch:
- Campaign is inserted only when its id does not already exist;
- initial Teams, Areas and Street/House Tasks are inserted behind the internal write-token guard;
- no existing Campaign is updated;
- no child rows are deleted or replaced;
- access grants and sessions are created by the surrounding create flow after the initial state succeeds.

The endpoint remains protected by the server-only bootstrap contract. It returns a conflict for an existing Campaign and fails closed when an additive Task schema required by the initial snapshot is unavailable.

Snapshot reads remain the protected read model. `PUT /api/campaigns/:id/snapshot` is retired and returns HTTP 410 without claiming a revision or writing D1. Normal Campaign, Team, Area, Street, House, Collection and Pickup changes use explicit M5 or specialized mutations.

### RxDB entity change feed (Mission branch)

Migration `0017_rxdb_sync_changes.sql` is additive and intentionally prepared
only. It stores a monotonic `seq`, Campaign id, one of five collection names,
document id, upsert/delete operation, scope Team id, bounded canonical document
JSON and timestamp. `campaign_sync_changes` is not a second source of truth:
the same Worker transaction first claims the Campaign revision and persists the
canonical narrow mutation, then appends entity deltas/tombstones guarded by that
claim. The RxDB pull endpoint pages it by checkpoint and never expands it to a
full Campaign snapshot per poll.

### M5 mutation write

Protected endpoint:
- `POST /api/campaigns/:id/mutations`.

For a new mutation the Worker:
1. validates the mutation;
2. computes its canonical SHA-256 fingerprint;
3. loads current snapshot;
4. applies the mutation in memory with target-specific conflict preconditions;
5. validates the resulting snapshot;
6. authorizes current/candidate snapshots using the existing Worker policy;
7. attempts a narrow row change and ledger insert guarded by current Campaign revision + internal `write_token`.

The D1 batch contains:
- Campaign revision/write-token claim;
- exactly the affected narrow domain statement;
- mutation ledger insert including the mutation fingerprint.

M6 Street creation may carry validated route provenance. M6 House uses narrow `house.create`, `house.rename`, `house.set-status` and `house.delete` mutations against `house_tasks`. Geometry/source values are prepared bindings; OSM ids, address labels and user text are never concatenated into SQL.

If the revision claim loses a race, the Worker reloads/re-evaluates for a bounded number of attempts. If the target remains compatible, the mutation can apply on the newer revision. If the target changed, an explicit conflict is returned.

If `(campaign_id, mutation_id)` already exists:
- matching fingerprint -> return prior applied revision without applying the effect again;
- different fingerprint -> return explicit `mutation_id_reused` conflict.

## Client durable queue data

IndexedDB stores unacknowledged mutation records while localStorage continues to store the latest snapshot cache.

Queue records are browser-local and include mutation payload, state, attempts/retry timing and last error. Smart Street/House create records may contain reviewed geometry and non-secret OSM provenance needed to persist the Task. They do not contain credentials.

During the short enqueue window there may also be one best-effort emergency localStorage shadow. It exists only to recover a mutation if IndexedDB enqueue fails or the page is interrupted before commit; after a successful IndexedDB transaction it is removed. Corrupt shadow data is discarded rather than treated as durable queue state.

## Future organization model

M8 plans an Organization tenant above Campaigns. It is not part of the current schema.

Requirements for future migration:
- existing Campaigns preserved;
- additive D1 migration;
- no first-visitor claim race;
- explicit organization authorization/membership;
- no cross-organization relationships.

See `docs/architecture/ORGANIZATIONS.md`.

## Collaboration/statistics data

The current prepared collaboration schema contains durable Comments, Field Sessions,
minimized `domain_events` and deterministic Automation configuration. Activity and
Statistics are projections/aggregations of those sources; they do not have a second
history or rollup table.

The Stats read path derives current Street-/House-task denominators from `tasks`,
`house_tasks` and their canonical Area/Team relationships. Session totals and the
bounded recent session list derive from `field_sessions`. A bounded 90-day status-change
series derives from `domain_events`. Collection session metrics remain separate from
Distribution progress; Pickup progress is not fabricated before a persistent Pickup
model exists.

The Worker performs the Campaign-/Team-/Field-Group scope filtering before returning
the small Stats DTO. The endpoint uses prepared queries and bounded reads. Prefer this
derivation from durable state/events; add rollups only after a measured scale need.
Do not add continuous GPS history for analytics.

See `docs/architecture/COLLABORATION.md`.

## Browser-only data

Intentionally local unless later changed:
- language preference;
- personal last map camera per Campaign;
- planned UI light/dark/system preference;
- active unsaved draw/edit draft;
- M5 IndexedDB queue until its mutations are acknowledged;
- short-lived best-effort M5 enqueue emergency shadow;
- GPS route history (none exists).

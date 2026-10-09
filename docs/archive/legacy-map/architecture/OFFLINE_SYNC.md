---
id: architecture-offline-sync
type: architecture
status: accepted
last_updated: 2026-09-02
related: [architecture-data, architecture-security, architecture-map, product-roadmap, ADR-0011, ADR-0013, ADR-0021, ADR-0022, ADR-0024, ADR-0025, plan-028-rxdb-local-first-mission-sync]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Mission RxDB branch

ADR-0024 governs `mission-rxdb-sync`, a separate branch from the verified
manual-mission rollback. RxDB/Dexie is the durable local replica for normalized
Campaign, Team, Area, Street Task and House Task collections. Its Worker pull
uses bounded per-collection checkpoints; push failures and conflicts return a
canonical document/tombstone for that entity only, so a rejected Team write
cannot halt Street/House pull.

The Worker adapts each accepted RxDB document write to the existing narrow M5
domain mutation path. D1 remains canonical and appends an entity delta or
tombstone to `campaign_sync_changes` in the same guarded D1 batch. Campaign and
Team text/color use a 900 ms trailing commit, flushable on blur, Enter and
sheet-close. Status writes remain immediate. The old M5 queue is import-only
for one guarded legacy recovery pass, never a concurrent normal writer.

Collection/Pickup mode remains on its established specialized mutation endpoint;
it is outside the five distribution collections and the RxDB-first branch.

### Realtime invalidation and safety recovery

ADR-0025 adds one Durable Object per Campaign as a hibernating WebSocket
fan-out. After a committed D1/feed write the Worker emits only a monotonic
`changed` sequence hint. Clients then use the authenticated per-collection Pull
endpoints; the DO never contains canonical documents, secrets or write
permissions. Duplicate, late or missed signals are safe because each replica
keeps its own checkpoint. A single Campaign-level checkpoint request runs every
45 seconds and triggers incremental Pull only when the high-water mark or global
revision advanced. No idle DO timer, Service Worker or Background Sync API is
used.

Migration `0017_rxdb_sync_changes.sql` is prepared only. A missing remote
schema returns explicit `rxdb_sync_schema_unavailable`; it must never be
applied, deployed or marked released by application code.

## Goal

A field user must not silently lose important saved changes because connectivity disappears, the page reloads, or another device edits the same Campaign.

M5 implements this through a page-owned durable mutation queue while preserving the website-only architecture.

The preceding M5 description and the queue-specific sections below describe the
stable/rollback line. On `mission-rxdb-sync`, RxDB/Dexie is the normal local
replica and the legacy queue is import-only; the Worker idempotency and
authorization contract remains shared.

## Deployment state

The durable mutation architecture is implemented in the current stable code line, with M5/M5.5 work already integrated before M6.

M6 Street/House persistence code has additive migrations prepared but they are not remotely applied automatically:
- 0004 adds optional Street source provenance;
- 0005 adds durable House Tasks.
- 0014 adds server-side automatic Area preparation state and optional automatic-generation markers.

Until intentional migration rollout, affected writes fail explicitly with `schema_migration_required` before claiming a Campaign revision.

The 0014 automatic preparation path instead fails closed as `area_preparation_schema_unavailable`; it never turns an Area mutation into a partial client-side fallback.

## Local state layers

### localStorage snapshot (all lines)

The versioned Campaign snapshot remains cached in localStorage as:
- fast startup state;
- recovery/safety copy;
- convenient React UI model.

It is not the durable delivery source of truth for new unacknowledged writes on
the stable line. The mission branch also keeps it as a startup/recovery cache,
while RxDB is the durable delivery source.

Schema-v3 compatibility is retained while M6 adds optional Street source provenance and optional `houseTasks`. Older/manual Street snapshots without either extension remain valid.

### IndexedDB mutation queue (stable/rollback line)

New saved domain changes are represented as explicit `CampaignMutation` records and persisted to IndexedDB before network delivery.

Each queue record contains:
- stable mutation id / idempotency key;
- Campaign id;
- explicit mutation type and payload;
- base revision;
- target-specific conflict preconditions;
- creation time;
- queue state;
- attempt count;
- next retry time;
- optional last error.

Queue states:
- `pending`;
- `retry`;
- `conflict`;
- `blocked-auth`;
- `invalid`.

During the short enqueue window a best-effort localStorage emergency shadow protects against an interrupted/failed IndexedDB write. A successful IndexedDB transaction clears that shadow; corrupt shadow data is quarantined rather than blocking the queue forever.

Smart Street and House create records may contain reviewed geometry plus non-secret OSM provenance. OSM ids are data, not authorization credentials.

## Supported mutation protocol

M5/M6 operations include:
- Campaign rename;
- shared Campaign default map view set/remove;
- Team create/update;
- Area create/rename/team assignment/geometry update/delete;
- Street Task create/rename/status update/delete;
- House Task create/rename/status update/delete.

Street `task.create` may carry optional validated source provenance. House operations use dedicated `house.*` mutation types while sharing the same durable queue, idempotency, revision and authorization protocol.

Automatic Area preparation is deliberately outside the browser mutation queue. A successful non-replayed `area.create` or `area.update-geometry` persists first, then the Worker schedules a server job with `waitUntil`. The job reads canonical D1 state, fetches bounded OSM data and atomically publishes ordinary Task rows plus one Campaign revision. It does not synthesize one client mutation per generated Task.

Personal camera movement is not a shared mutation.

The current snapshot-oriented React UI is bridged by `deriveCampaignMutation(previous, next)`. A normal supported save must derive one unambiguous mutation. Unsupported compound snapshot changes fail visibly rather than silently falling back to a broad ordinary write.

For existing reviewed Smart Street and House Tasks, source geometry/provenance is immutable through ordinary rename/status mutations. House parent Street relation is also immutable except for deterministic clearing when the parent Street is deleted.

Automatic Tasks remain normal status-bearing Tasks, but their non-null preparation generation is server-owned: browser create payloads cannot supply it and browser deletes return `auto_prepared_task_delete_forbidden`. Geometry changes are rejected with `area_has_started_work` once any automatic Task in the Area has left `open`; deleting the complete Area retains the established cascade.

## Conflict semantics

Mutations can be replayed over unrelated newer Campaign revisions when their actual target is still unchanged.

Preconditions:
- entity edits/deletes use the target entity `updatedAt` observed when queued;
- Campaign name/default map view use field-specific expected previous values;
- creates require the new id not to exist and referenced parent/team records to remain valid;
- House create requires its Area to exist and an optional parent Street to be in the same Area.

If the target itself changed or disappeared, the Worker returns an explicit conflict. There is no intentional silent last-write-wins merge.

## Queue processing (stable/rollback line)

The mission branch uses RxDB's per-collection replication retry and leader
election instead. The legacy queue is read only for the guarded one-time import
described in the Mission RxDB section above.

The active Campaign queue is processed sequentially in local revision order.

Retry triggers while the website is open:
- initial authenticated startup;
- connectivity return (`online`);
- visible-tab return;
- manual refresh;
- continuation after a successful earlier queue item.

Retryable network/408/429/5xx failures use bounded exponential backoff. There is no tight retry loop.

Terminal behavior:
- success/already-applied -> remove the item;
- conflict -> retain as `conflict` and stop ordered processing;
- 401/403 -> retain as `blocked-auth` and stop blind retries;
- invalid non-retryable request -> retain as `invalid`;
- retryable failure -> retain as `retry`.

`schema_migration_required` is non-destructive: the mutation remains unsatisfied rather than being silently coerced to an older schema.

## Server idempotency

The Worker exposes authenticated `POST /api/campaigns/:id/mutations`.

For each request it:
1. resolves the existing Campaign access/session;
2. validates the mutation envelope/payload;
3. computes the canonical SHA-256 mutation fingerprint;
4. loads current Campaign state;
5. applies one mutation in memory;
6. validates the resulting snapshot;
7. runs current/candidate state through the existing Worker authorization policy;
8. persists a narrow D1 change plus idempotency ledger entry.

Migration `0003_m5_mutations.sql` adds `campaign_mutations` keyed by `(campaign_id, mutation_id)`.

Street creation uses bound `geometry_json` and optional `source_json`. House creation uses bound Polygon JSON, optional source JSON and optional parent Street id in `house_tasks`. Labels, OSM ids and geometry are never concatenated into SQL text.

If a mutation id already exists:
- same canonical fingerprint/content -> return its prior applied revision and do not apply the effect again;
- different fingerprint/content -> return `409 mutation_id_reused` and do not apply the changed effect.

Persistence uses the Campaign revision plus internal `write_token` as the concurrency claim. On a concurrent revision move, the Worker reloads and re-evaluates the mutation for a bounded number of attempts.

## Authorization

Campaign id remains only a selector.

Worker authorization remains authoritative:
- Viewer cannot write;
- Team Editor remains limited to its Team scope for Areas, Streets and Houses;
- Admin may perform Campaign-wide changes;
- revoked/expired access blocks queued writes on the next request.

The client sync label is UX only and is never an authorization boundary.

Under ADR-0013, existing reviewed Street source and House geometry/source/parent snapshots are protected from accidental mutation by ordinary task mutations, including for Admin. Deleting the entire Task is distinct from silently rewriting reviewed source data. A full-snapshot compatibility write is no longer available.

## Active draw/edit safety

Unsaved intermediate vertices remain local UI interaction state and are not queued. Historical Smart selection helpers, where retained outside the normal product path, also never enter the queue.

Protected modes include:
- Area draw;
- Area edit;
- Street draw;

The existing interaction-block mechanism continues to prevent canonical server refresh from silently destroying active geometry. Saved MapLibre data changes only when Campaign snapshot state changes.

## Snapshot cache and retired legacy write

A pre-M5 optimistic local snapshot can exist without a corresponding IndexedDB queue record. The local snapshot remains a startup cache and conflict/recovery copy, not an upload payload.

If the queue is empty and the local snapshot differs from the canonical server snapshot, the client preserves the local state in the existing conflict storage, applies the canonical server state and exposes a visible conflict/recovery hint. It does not perform an automatic server write. Queued domain mutations remain authoritative and are retried through the M5 queue.

`PUT /api/campaigns/:id/snapshot` is retired. The Worker returns HTTP 410 with `legacy_snapshot_write_retired` before accepting the payload, claiming a revision or touching D1. `POST /api/campaigns` remains a create-only revision-0 bootstrap.

## Website-only constraints

- no Service Worker;
- no installable PWA;
- no Web App Manifest install flow;
- no Background Sync API;
- no offline whole-area basemap cache;
- synchronization progresses only while the website is open.

Server preparation is not a browser offline-download requirement. Devices consume persisted prepared Tasks through the normal snapshot. On the stable line the M5 Mutation Queue and Snapshot-Cache remain the offline-relevant product boundary; on the mission branch the RxDB replica replaces the normal queue. Retained local map context has no normal Settings download flow and cannot become preparation truth.

## Renderer boundary

M6 persistence does not change ADR-0010:
- MapLibre GL JS remains pinned to 5.7.1;
- saved Areas/Streets remain persistent MapLibre GeoJSON sources/layers;
- durable House data exists separately until a dedicated batched House map-layer slice is accepted/tested on the stable line; the mission branch materializes its RxDB `houseTasks` collection into the same read model;
- active draw/edit/review interaction remains outside the saved persistent layer model until Task creation;
- normal browse has no application loop projecting all saved geometry.

See ADR-0011 for mutation/idempotency behavior, ADR-0013 for Smart Street/House identity/source geometry and ADR-0022 for the final no-legacy-snapshot-write boundary.

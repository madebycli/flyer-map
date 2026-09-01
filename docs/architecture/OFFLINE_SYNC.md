---
id: architecture-offline-sync
type: architecture
status: accepted
last_updated: 2026-09-01
related: [architecture-data, architecture-security, architecture-map, product-roadmap, ADR-0011, ADR-0013, ADR-0021]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose important saved changes because connectivity disappears, the page reloads, or another device edits the same Campaign.

M5 implements this through a page-owned durable mutation queue while preserving the website-only architecture.

## Deployment state

The durable mutation architecture is implemented in the current stable code line, with M5/M5.5 work already integrated before M6.

M6 Street/House persistence code has additive migrations prepared but they are not remotely applied automatically:
- 0004 adds optional Street source provenance;
- 0005 adds durable House Tasks.
- 0014 adds server-side automatic Area preparation state and optional automatic-generation markers.

Until intentional migration rollout, affected writes fail explicitly with `schema_migration_required` before claiming a Campaign revision.

The 0014 automatic preparation path instead fails closed as `area_preparation_schema_unavailable`; it never turns an Area mutation into a partial client-side fallback.

## Local state layers

### localStorage snapshot

The versioned Campaign snapshot remains cached in localStorage as:
- fast startup state;
- recovery/safety copy;
- convenient React UI model.

It is not the durable delivery source of truth for new unacknowledged writes.

Schema-v3 compatibility is retained while M6 adds optional Street source provenance and optional `houseTasks`. Older/manual Street snapshots without either extension remain valid.

### IndexedDB mutation queue

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

## Queue processing

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

Under ADR-0013, existing reviewed Street source and House geometry/source/parent snapshots are protected from accidental mutation by the legacy full-snapshot compatibility write, including for Admin. Deleting the entire Task is distinct from silently rewriting reviewed source data.

## Active draw/edit safety

Unsaved intermediate vertices and Smart selection drafts remain local UI interaction state and are not queued.

Protected modes include:
- Area draw;
- Area edit;
- Street draw;
- Smart Street start/end/waypoint review;
- Smart House selection before the user confirms creation.

The existing interaction-block mechanism continues to prevent canonical server refresh from silently destroying active geometry. Saved MapLibre data changes only when Campaign snapshot state changes.

## Legacy transition path

A pre-M5 optimistic local snapshot can exist without a corresponding IndexedDB queue record. During transition, the authorized coarse snapshot PUT may be used only for compatibility/recovery behavior that remains intentionally supported.

New ordinary edits must use the mutation queue and must not return to arbitrary full-snapshot replacement as their normal delivery path.

The compatibility write detects missing M6 schema before revision claim. It may preserve/delete whole reviewed Tasks when authorized, but may not strip or rewrite reviewed provenance/geometry while retaining the Task.

## Website-only constraints

- no Service Worker;
- no installable PWA;
- no Web App Manifest install flow;
- no Background Sync API;
- no offline whole-area basemap cache;
- synchronization progresses only while the website is open.

Server preparation is not a browser offline-download requirement. Devices consume the persisted prepared Tasks through the normal snapshot; optional local offline OSM packages remain a separate map-context feature.

## Renderer boundary

M6 persistence does not change ADR-0010:
- MapLibre GL JS remains pinned to 5.7.1;
- saved Areas/Streets remain persistent MapLibre GeoJSON sources/layers;
- durable House data exists separately until a dedicated batched House map-layer slice is accepted/tested;
- active draw/edit/review interaction remains outside the saved persistent layer model until Task creation;
- normal browse has no application loop projecting all saved geometry.

See ADR-0011 for mutation/idempotency behavior and ADR-0013 for Smart Street/House identity/source geometry.

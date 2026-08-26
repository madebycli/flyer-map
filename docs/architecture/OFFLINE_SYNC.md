---
id: architecture-offline-sync
type: architecture
status: accepted
last_updated: 2026-08-26
related: [architecture-data, architecture-security, architecture-map, product-roadmap, ADR-0011, ADR-0013]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose important saved changes because connectivity disappears, the page reloads, or another device edits the same Campaign.

M5 implements this through a page-owned durable mutation queue while preserving the website-only architecture.

## Deployment state

The durable mutation architecture is implemented in the current stable code line, with M5/M5.5 work already integrated before this M6 Workbench stack.

M6 Smart Street persistence is still Workbench-only. Its additive `0004_m6_task_source_provenance.sql` migration must not be treated as remotely applied until the stack is intentionally promoted.

## Local state layers

### localStorage snapshot

The versioned Campaign snapshot remains cached in localStorage as:
- fast startup state;
- recovery/safety copy;
- convenient React UI model.

It is not the durable delivery source of truth for new unacknowledged writes.

Schema-v3 compatibility is retained while M6 adds optional Task source provenance. Older/manual Street Task objects without `source` remain valid.

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

A Smart Street `task.create` queue record may contain the reviewed LineString snapshot and its non-secret OSM source provenance. OSM ids are data, not authorization credentials.

## Supported mutation protocol

Initial M5 operations:
- Campaign rename;
- shared Campaign default map view set/remove;
- Team create/update;
- Area create/rename/team assignment/geometry update/delete;
- Street Task create/rename/status update/delete.

M6 keeps the same `task.create` operation and extends its payload with optional validated source provenance. Smart Street Task identity remains the normal application-generated `task_*` id.

Personal camera movement is not a shared mutation.

The current snapshot-oriented React UI is bridged by `deriveCampaignMutation(previous, next)`. A normal supported save must derive one unambiguous mutation. Unsupported compound snapshot changes fail visibly rather than silently falling back to a broad ordinary write.

For existing Tasks, geometry and source provenance are immutable through ordinary rename/status mutations. A future source/geometry reconciliation flow requires its own explicit reviewed operation.

## Conflict semantics

Mutations can be replayed over unrelated newer Campaign revisions when their actual target is still unchanged.

Preconditions:
- entity edits/deletes use the target entity `updatedAt` observed when queued;
- Campaign name/default map view use field-specific expected previous values;
- creates require the new id not to exist and referenced parent/team records to remain valid.

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

The M6 Workbench `task.create` narrow statement adds a bound `source_json` value after migration `0004`; geometry, source ids and labels remain parameters rather than SQL text.

If a mutation id already exists:
- same canonical fingerprint/content -> return its prior applied revision and do not apply the effect again;
- different fingerprint/content -> return `409 mutation_id_reused` and do not apply the changed effect.

Persistence uses the Campaign revision plus internal `write_token` as the concurrency claim. On a concurrent revision move, the Worker reloads and re-evaluates the mutation for a bounded number of attempts.

## Authorization

Campaign id remains only a selector.

Worker authorization remains authoritative:
- Viewer cannot write;
- Team Editor remains limited to its Team scope;
- Admin may perform Campaign-wide changes;
- revoked/expired access blocks queued writes on the next request.

The client sync label is UX only and is never an authorization boundary.

Under ADR-0013, existing Smart Street source provenance is also protected from accidental mutation by the legacy full-snapshot compatibility write, including for Admin. Deleting the entire Task is distinct from silently rewriting its source metadata.

## Active draw/edit safety

Unsaved intermediate vertices remain local UI interaction state and are not queued.

Protected modes remain:
- Area draw;
- Area edit;
- Street draw;
- Smart Street start/end/waypoint review while it is still an unsaved selection draft.

The existing interaction-block mechanism continues to prevent canonical server refresh from silently destroying active geometry. The saved MapLibre renderer receives data only when Campaign snapshot state changes; M6 does not recreate the map or change its camera lifecycle.

## Legacy transition path

A pre-M5 optimistic local snapshot can exist without a corresponding IndexedDB queue record. During transition, the authorized coarse snapshot PUT may be used only for the compatibility/recovery behavior that remains intentionally supported.

New ordinary edits must use the mutation queue and must not return to arbitrary full-snapshot replacement as their normal delivery path.

If an existing Task already has Smart Street provenance, the compatibility write may preserve or delete the whole Task when authorized, but may not strip/change the existing provenance while keeping the Task.

## Website-only constraints

- no Service Worker;
- no installable PWA;
- no Web App Manifest install flow;
- no Background Sync API;
- no offline whole-area basemap cache;
- synchronization progresses only while the website is open.

## Renderer boundary

M6 does not change ADR-0010:
- MapLibre GL JS remains pinned to 5.7.1;
- saved Areas/Streets remain persistent MapLibre GeoJSON sources/layers;
- active draw/edit/review interaction remains outside the saved persistent layer model until Task creation;
- normal browse has no application loop projecting all saved geometry.

See ADR-0011 for mutation/idempotency behavior and ADR-0013 for Smart Street Task identity/source geometry.

---
id: architecture-offline-sync
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-data, architecture-security, architecture-map, product-roadmap]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose important saved changes because connectivity disappears, the page reloads, or another device edits the same Campaign.

M5 implements this through a page-owned durable mutation queue while preserving the website-only architecture.

## Deployment state

The durable mutation architecture is implemented in active PR #24 / Plan 010 and is **not yet the production baseline**.

Production remains on the pre-M5 persistence path until:
- final PR checks and Cloudflare preview pass;
- additive D1 migration `0003_m5_mutations.sql` is applied to the target environment;
- browser acceptance confirms reload/reconnect/conflict/auth behavior.

## Local state layers

### localStorage snapshot

The versioned Campaign snapshot remains cached in localStorage as:
- fast startup state;
- recovery/safety copy;
- convenient React UI model.

It is not the durable delivery source of truth for new unacknowledged M5 writes.

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

## Supported mutation protocol

Initial M5 operations:
- Campaign rename;
- shared Campaign default map view set/remove;
- Team create/update;
- Area create/rename/team assignment/geometry update/delete;
- Street Task create/rename/status update/delete.

Personal camera movement is not a shared mutation.

The current snapshot-oriented React UI is bridged by `deriveCampaignMutation(previous, next)`. A normal supported save must derive one unambiguous mutation. Unsupported compound snapshot changes fail visibly rather than silently falling back to a broad ordinary write.

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
3. loads current Campaign state;
4. applies one mutation in memory;
5. validates the resulting snapshot;
6. runs current/candidate state through the existing Worker authorization policy;
7. persists a narrow D1 change plus idempotency ledger entry.

Migration `0003_m5_mutations.sql` adds `campaign_mutations` keyed by `(campaign_id, mutation_id)`.

If a mutation id already exists, the server returns its prior applied revision and does not apply the effect again.

Persistence uses the Campaign revision plus internal `write_token` as the concurrency claim. On a concurrent revision move, the Worker reloads and re-evaluates the mutation for a bounded number of attempts.

## Authorization

Campaign id remains only a selector.

Worker authorization remains authoritative:
- Viewer cannot write;
- Team Editor remains limited to its Team scope;
- Admin may perform Campaign-wide changes;
- revoked/expired access blocks queued writes on the next request.

The client sync label is UX only and is never an authorization boundary.

## Active draw/edit safety

Unsaved intermediate vertices remain local UI interaction state and are not queued.

Protected modes remain:
- Area draw;
- Area edit;
- Street draw.

The existing interaction-block mechanism continues to prevent canonical server refresh from silently destroying active geometry. The saved MapLibre renderer receives data only when Campaign snapshot state changes; M5 does not recreate the map or change its camera lifecycle.

## Legacy transition path

A pre-M5 optimistic local snapshot can exist without a corresponding IndexedDB queue record. During transition, the authorized coarse snapshot PUT may be used once to reconcile that legacy state.

New ordinary M5 edits must use the mutation queue and must not return to arbitrary full-snapshot replacement as their normal delivery path.

## Website-only constraints

- no Service Worker;
- no installable PWA;
- no Web App Manifest install flow;
- no Background Sync API;
- no offline whole-area basemap cache;
- synchronization progresses only while the website is open.

## Renderer boundary

M5 does not change ADR-0010:
- MapLibre GL JS remains pinned to 5.7.1;
- saved Areas/Streets remain persistent MapLibre GeoJSON sources/layers;
- active draw/edit remains SVG-only;
- normal browse has no application loop projecting all saved geometry.

See ADR-0011 for the mutation/idempotency decision and Plan 010 for current implementation/release acceptance.

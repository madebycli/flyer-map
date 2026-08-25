---
id: ADR-0011
type: decision
status: accepted
date: 2026-08-25
---

# ADR-0011: Page-owned durable mutation queue with server idempotency

## Context

The current shared-state path protects Campaign data with revocable sessions and Worker-side authorization, but normal writes still use coarse complete-snapshot replacement. The browser only keeps the newest unsent snapshot in memory. Reload or temporary connectivity loss can therefore interrupt delivery, and whole-snapshot replacement is too coarse for useful conflict handling when several field devices edit different entities.

Verteil-Flyer is intentionally a normal website. ADR-0006 forbids an installable PWA, Service Worker and Web App Manifest. M5 therefore needs resilient writes without Service Worker lifecycle or Background Sync.

The current localStorage snapshot remains valuable as fast startup/recovery state and must remain during transition.

## Decision

### Durable client queue

Use IndexedDB for unacknowledged Campaign mutations. Each record contains:
- globally unique mutation id/idempotency key;
- Campaign id;
- explicit mutation type/payload;
- local base revision;
- conflict preconditions for the affected field/entity;
- creation time;
- queue state, attempt count, next-attempt time and optional last error.

Mutations are processed sequentially for the active Campaign. The page retries on initialization, `online`, visible-tab return and manual refresh. Retryable network/server failures use bounded exponential backoff.

IndexedDB persistence waits for the transaction to complete, not merely for the individual request callback.

### Enqueue crash window

The existing localStorage snapshot remains the fast startup/recovery view, but it is not the source of truth for unacknowledged M5 delivery.

During the short interval before a new mutation is durably committed to IndexedDB, the browser may keep one emergency localStorage shadow of the mutation being enqueued. If the IndexedDB write fails or the page is interrupted, the next queue read attempts to restore that shadow into IndexedDB. After the IndexedDB transaction commits, the shadow is removed.

This emergency shadow is best-effort only:
- failure to write the shadow must not block a successful IndexedDB enqueue;
- corrupt shadow data is quarantined/removed rather than blocking the queue forever;
- ordered unacknowledged work still lives in IndexedDB after successful enqueue.

### Local snapshot transition

React may continue to use a Campaign snapshot as its convenient local UI model. localStorage remains startup/recovery cache. The synchronization source of truth for **unacknowledged M5 changes** is the IndexedDB queue, not an in-memory pending snapshot.

A pre-M5 optimistic snapshot without a corresponding queue item may use the legacy authorized snapshot PUT once as a transition/recovery path. New ordinary M5 edits must use mutation delivery.

Intermediate draw/edit vertices remain local interaction state. An explicit Save creates the durable mutation.

### Explicit mutation protocol

Initial supported operations:
- Campaign rename;
- Campaign shared default map view set/remove;
- Team create/update;
- Area create/rename/team assignment/geometry update/delete;
- Street Task create/rename/status update/delete.

Personal camera movement is not a mutation.

Entity edits/deletes carry the `updatedAt` value observed when the mutation was created. Campaign name/map-focus operations carry field-specific previous values. This allows safe replay over unrelated newer revisions while detecting changes to the actual target.

### Worker validation and authorization

Every mutation request resolves the existing Campaign session/grant first. Campaign id remains only a selector.

The Worker loads current Campaign state, applies one mutation in memory, validates the resulting snapshot and passes current/candidate snapshots through the existing authorization policy. Viewer writes are rejected; Team Editor remains limited to its scoped Team. Revoked access turns queued work into authorization-blocked state rather than blind retry.

### D1 idempotency and narrow writes

Add `migrations/0003_m5_mutations.sql` with a Campaign-scoped mutation ledger keyed by `(campaign_id, mutation_id)`. Existing migrations stay immutable.

Each accepted mutation is canonicalized with deterministic object-key ordering and hashed with SHA-256. The ledger stores that 64-character fingerprint together with the mutation id/type/revisions.

Before persistence, the Worker checks the ledger:
- same Campaign + same mutation id + same fingerprint returns the original applied revision and does not apply the effect again;
- same Campaign + same mutation id + different fingerprint returns explicit `mutation_id_reused` conflict and is never treated as a successful retry.

For a new mutation, persistence uses the current Campaign revision and internal `write_token` as the concurrency claim. One D1 batch:
1. claims the expected Campaign revision and installs a fresh internal write token;
2. changes only the affected Campaign/Team/Area/Task row(s);
3. records mutation id, fingerprint and applied revision, guarded by the same write token.

A failed claim causes bounded reload/re-evaluation. There is no fallback to whole-snapshot replacement for an ordinary M5 mutation.

### Client terminal states

Queue processing distinguishes:
- success/already-applied -> remove item;
- retryable network/server failure -> retain with backoff;
- conflict -> retain as conflict and stop ordered processing;
- authorization failure -> retain as blocked-auth and stop blind retry;
- invalid mutation -> retain as invalid/failed.

## Renderer boundary

This decision does **not** change the accepted map renderer from ADR-0010:
- saved Areas/Streets remain persistent MapLibre GeoJSON sources/layers;
- active draw/edit geometry remains SVG-only;
- normal browse still performs no application-wide saved-geometry projection loop;
- MapLibre stays pinned to 5.7.1 unless separately accepted.

## Consequences

Positive:
- saved edits survive reload and temporary connectivity loss;
- duplicate retries cannot duplicate effects;
- accidental/malicious reuse of an idempotency id with changed content is detected instead of acknowledged;
- unrelated newer server changes can coexist with safe queued edits;
- real target conflicts become explicit;
- normal writes become narrower while existing Worker authorization remains the security boundary;
- website-only architecture is preserved.

Tradeoffs:
- synchronization progresses only while the website is open;
- localStorage and IndexedDB coexist during transition;
- the emergency enqueue shadow adds one small best-effort local recovery record;
- one terminal queue item blocks later ordered work until resolved;
- the legacy snapshot PUT remains temporarily available for compatibility/recovery and must not become the normal M5 write path.

## Revisit when

Revisit if the product needs richer conflict-merge UX, substantially higher concurrent write volume, or a future Organization/account model. None of those imply a Service Worker or PWA without a separate accepted decision.

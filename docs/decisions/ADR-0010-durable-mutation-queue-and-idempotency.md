---
id: ADR-0010
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0010: Use a page-owned durable mutation queue with server idempotency

## Context

M4 protects shared Campaign data with revocable sessions and Worker-side authorization, but its normal write path still sends a complete client snapshot. The browser only keeps the newest unsent snapshot in memory. A reload or short loss of connectivity can therefore interrupt delivery, and a whole-snapshot replacement is too coarse for safe conflict handling when several field devices edit different entities.

Verteil-Flyer is intentionally a normal mobile-first website. ADR-0006 forbids an installable PWA, Service Worker and Web App Manifest. M5 therefore needs resilient writes without relying on Service Worker lifecycle, Background Sync or background execution after the page is closed.

The existing localStorage snapshot remains valuable as fast startup/recovery state and must not be discarded during the transition.

## Decision

### Durable client queue

Use IndexedDB for unacknowledged Campaign mutations. Each queue record contains at least:

- a globally unique mutation id, also used as the idempotency key;
- Campaign id;
- explicit mutation type and payload;
- local base revision;
- conflict preconditions for the affected field/entity;
- mutation creation time;
- queue state, attempt count, next-attempt time and optional last error.

Mutations are enqueued in local revision order and processed sequentially for the active Campaign. The page retries on startup, `online`, visible-tab transition and manual refresh. Retryable network/server failures use bounded exponential backoff. There is no tight polling loop and no Background Sync API.

### Local snapshot transition

React may continue to use a Campaign snapshot as its convenient local UI model. localStorage remains the fast startup/recovery cache. The synchronization source of truth for **unacknowledged changes** is the IndexedDB queue, not an in-memory pending snapshot.

Existing M4 local snapshots are not deleted. A pre-M5 optimistic snapshot that has no corresponding queue entry may use the legacy authorized snapshot PUT once as a transition/recovery path. New ordinary M5 edits do not use complete-snapshot PUTs.

Draft drawing/editing remains local UI state. Intermediate vertices do not enter the queue. The explicit Save action changes the Campaign snapshot once and therefore produces one durable mutation.

### Explicit mutation protocol

The M5 protocol models these operations explicitly:

- Campaign rename;
- Campaign shared default map view set/remove;
- Team create/update;
- Area create/rename/team assignment/geometry update/delete;
- Street Task create/rename/status update/delete.

Personal camera movement is never a mutation.

A mutation may be safely replayed on a newer Campaign revision when its affected target still satisfies its conflict precondition. Entity edits/deletes use the entity `updatedAt` observed when the mutation was created. Campaign name and shared map focus use field-specific previous values so unrelated entity writes do not create false Campaign conflicts.

If a target was independently changed or removed, the Worker returns a conflict rather than silently applying last-write-wins.

### Worker authorization and validation

Every mutation request still resolves the M4 session/grant first. Campaign id remains only a selector.

The Worker loads the current Campaign snapshot, applies the single mutation in memory, validates the resulting domain snapshot and passes current/candidate snapshots through the existing M4 authorization policy. This preserves the Admin / Team Editor / Viewer boundary without trusting client-side mutation labels.

Viewer writes are rejected. Team Editor remains limited to its scoped Team's Areas and Tasks. Revoked access fails on the next request and the client marks the queue as authorization-blocked instead of retrying blindly.

### D1 idempotency and narrow writes

Add `migrations/0003_m5_mutations.sql` with a Campaign-scoped mutation ledger keyed by `(campaign_id, mutation_id)`. `0001_initial.sql` and `0002_m4_access.sql` remain immutable.

Before persistence, the Worker checks the ledger. An already-recorded mutation returns its applied revision and is not applied again.

For a new mutation, D1 persistence uses the existing Campaign revision and internal `write_token` as the concurrency claim. One D1 batch:

1. claims the expected current Campaign revision and installs a fresh internal write token;
2. changes only the affected Campaign/Team/Area/Task row(s);
3. records the mutation id and applied revision in the idempotency ledger, guarded by the same write token.

A failed revision claim causes the Worker to reload and re-evaluate the mutation against the new server state for a bounded number of attempts. It never falls back to replacing the whole client snapshot.

### Client terminal states

Queue processing distinguishes:

- success/already applied: remove the queue item and adopt the acknowledged server revision;
- retryable network/server failure: retain and retry with backoff;
- conflict: retain as conflict and stop ordered processing;
- authorization/revocation failure: retain as authorization-blocked and stop retries;
- invalid mutation: retain as failed/invalid and stop retries.

The map remains the main surface. A compact sync chip shows saved, waiting, syncing, offline-saved, conflict, failed or access-changed state.

## Consequences

Positive:

- a saved edit survives reload and temporary connectivity loss;
- retries are idempotent and cannot duplicate Areas or Tasks;
- independent newer server changes can coexist with safe queued edits;
- actual target conflicts become explicit instead of silent last-write-wins;
- M4 authorization remains the Worker security boundary;
- normal writes no longer replace arbitrary full client snapshots;
- no Service Worker, Background Sync or PWA lifecycle is introduced.

Tradeoffs:

- synchronization only progresses while the website is open; this is intentional for the website-only architecture;
- localStorage and IndexedDB coexist during the transition and must be reconciled carefully;
- ordered queues stop behind a terminal conflict/authorization failure until the situation is resolved;
- the Worker currently validates authorization by applying one mutation to the current snapshot in memory before issuing the narrow D1 write;
- the legacy snapshot PUT remains temporarily available for M4 recovery and Campaign creation compatibility, so it must not become the normal M5 write path again.

## Renderer boundary

This decision does not change map rendering. MapLibre remains responsible only for CARTO Voyager Retina basemap, camera, rotation/compass and geolocation control. Areas, streets, drafts and edit handles remain in the SVG overlay. No MapLibre application GeoJSON layers are introduced.

## Revisit when

Revisit if the product needs multi-Campaign queues in one tab, user-driven conflict resolution/merge UI, substantially higher concurrent write volume, or account-backed identity. A Service Worker or installable PWA is not implied by those future needs and would require a separate accepted decision.

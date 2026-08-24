---
id: architecture-offline-sync
type: architecture
status: active
last_updated: 2026-08-24
related: [architecture-data, architecture-security]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose a manual campaign/task change because connectivity disappears or another device edits the same campaign.

## M3 local-first behavior

The versioned campaign snapshot remains in browser localStorage.

A normal local mutation:
1. updates React state immediately;
2. writes the updated snapshot to the primary + backup localStorage cache;
3. queues the latest snapshot for an asynchronous Worker `PUT` while the page is open;
4. on acknowledgement, stores the canonical server revision locally.

This preserves the responsive field interaction that existed before D1.

M3 is not a service-worker offline app and does not pretend the basemap is offline-capable.

## Startup transition

The browser renders local data first so startup does not wait for D1.

When online:
- `?campaign=` selects the shared campaign when present;
- otherwise the local campaign id becomes the selected shared campaign and is added to the URL;
- a missing D1 campaign can be bootstrapped from the existing local snapshot;
- a newer server snapshot replaces the cache;
- a materially different local snapshot is preserved in the conflict backup before replacement.

Existing local data is never intentionally deleted as part of M3 migration.

## Revision and polling

The browser keeps the last acknowledged server revision separately from optimistic local changes.

Writes send `baseRevision`; the Worker advances the revision only when that base still matches.

The browser polls `/version` approximately every five seconds while the page is visible/online and also checks again when connectivity or visibility returns. If a newer revision is detected and no local write is pending, it loads the current server snapshot and refreshes the local cache/UI.

No WebSockets are used in M3.

## Conflict/rejection behavior

There is no silent last-write-wins behavior.

If a snapshot write is rejected or returns HTTP 409:
1. preserve the rejected optimistic snapshot in `verteil-flyer:campaign-snapshot:conflict` when browser storage allows it;
2. visibly inform the user;
3. fetch the current server snapshot;
4. cache/load the server state.

If the current server snapshot cannot be fetched, the optimistic local snapshot remains available on that device and the user is informed instead of silently losing it.

## Temporary connectivity loss

For M3, ordinary transient failures keep the latest unsent snapshot in memory while the current page remains open and retry when connectivity returns. The localStorage primary/backup copy still protects the last local domain state across a normal reload.

M3 deliberately does **not** implement a durable multi-mutation queue, idempotency ledger or background sync.

## M5 durable queue direction

A later resilient synchronization milestone may:
1. store unsent mutations durably in browser storage such as IndexedDB;
2. give mutations idempotency keys;
3. retry across page reloads;
4. preserve ordering/reversal semantics for Undo;
5. expose pending/sync-error state more granularly.

That work must keep the website-only constraint and must not add a service worker merely to queue mutations.

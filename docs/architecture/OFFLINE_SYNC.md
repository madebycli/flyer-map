---
id: architecture-offline-sync
type: architecture
status: proposed
last_updated: 2026-08-24
related: [architecture-data, architecture-security]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose a manual completion action because mobile connectivity disappears temporarily.

## Planned model

1. Apply safe task-state changes optimistically in the UI.
2. Store unsent mutations in IndexedDB.
3. Give every mutation a unique idempotency key.
4. Submit/retry when connectivity is available.
5. Remove a mutation only after server acknowledgement.
6. Display pending/sync-error state to the user.

## Conflict principle

Do not rely on "last write wins" without visibility.

Before implementation, define server-side task versioning and what happens when two devices change the same task differently.

## Service worker

The foundation service worker intentionally does not cache application data yet. Offline application caching and mutation synchronization are a dedicated milestone to avoid shipping stale-state bugs accidentally.

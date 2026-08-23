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

## Current M1 behavior

The campaign/team/area snapshot is stored in browser localStorage so those edits survive reloads on the same device.

This is not shared synchronization and not an offline app shell. It only protects the current local M1 domain state from a normal reload.

## Planned mutation model

1. Apply safe task-state changes optimistically in the UI.
2. Store unsent mutations in browser storage, likely IndexedDB once mutation queuing is required.
3. Give every mutation a unique idempotency key.
4. Submit/retry when connectivity is available.
5. Remove a mutation only after server acknowledgement.
6. Display pending/sync-error state to the user.

## Conflict principle

Do not rely on "last write wins" without visibility.

The M1 campaign snapshot already carries a coarse `revision` field. Before shared writes are implemented, define server-side version checks and what happens when two devices change the same entity differently.

## Website-only constraint

Verteil-Flyer does not use a service worker or Web App Manifest.

Connectivity resilience must be implemented with normal browser storage and Worker API behavior. Do not reintroduce a service worker just to queue mutations or cache the app shell.

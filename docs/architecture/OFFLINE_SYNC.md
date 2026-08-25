---
id: architecture-offline-sync
type: architecture
status: accepted
last_updated: 2026-08-25
related: [architecture-data, architecture-security, architecture-map, product-roadmap]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Current goal

A field user must not silently lose important changes because connectivity disappears or another device edits the same Campaign.

Current M4-era synchronization is the baseline; M5 is the next planned hardening step.

## Current behavior

The versioned Campaign snapshot remains cached in localStorage.

A normal local mutation currently:
1. updates React/in-memory state immediately;
2. caches the updated snapshot locally;
3. sends the authorized snapshot asynchronously while the page is open;
4. tracks the acknowledged server revision.

The site remains a normal website: no service worker, installable PWA, Background Sync API or offline basemap cache.

## Startup/access

The browser may render last-known local data immediately, then resolves/redeems Campaign access and checks the protected Worker state.

A Campaign id selects a Campaign but does not authorize access.

A newer authorized server snapshot can replace the in-memory snapshot after safety checks. Personal map camera state is separate and is not reset by data refresh.

## Revision polling

Normal checks use the small Campaign version endpoint roughly every 30 seconds while initialized, plus:
- connectivity return;
- tab visibility return;
- manual refresh.

Only when a newer revision exists does the browser fetch the full snapshot.

When Campaign data changes, saved MapLibre GeoJSON sources receive new data from the in-memory snapshot; the map instance/camera remain alive.

## Active draw/edit safety

Unsaved active interaction must never be silently destroyed.

Protected modes:
- Area draw;
- Area edit;
- Street draw.

If newer server data is discovered during one of these modes:
- preserve the active vertices;
- show that newer data is available;
- defer replacement until the interaction safely finishes/cancels;
- then recheck/apply server state when safe.

## Current conflict/rejection behavior

There is no intentional silent last-write-wins path.

Rejected/409/unauthorized optimistic state is preserved when possible in a local conflict safety copy and a visible sync/access warning is surfaced.

If authorization is revoked, protected requests stop succeeding until valid access is supplied.

## Current limitation

The current system does **not** provide a durable ordered mutation queue across reloads. It still relies on coarse snapshot revision semantics and local cache safety.

This is the reason M5 is next.

## M5 durable mutation direction

M5 should introduce:
- IndexedDB-backed pending mutation storage;
- stable mutation/idempotency ids;
- idempotent server application ledger/semantics;
- narrower mutation-specific operations where practical;
- retry across reload/online/visibility/manual refresh;
- explicit ordering where operations depend on each other;
- visible pending/error/conflict states;
- authorization-aware stop conditions after revocation;
- event/domain records that later Activity/Statistics can consume.

The current snapshot remains useful as startup/recovery cache during transition.

## M5 constraints

- no service worker merely to queue mutations;
- no Background Sync API;
- no silent conflict overwrite;
- Worker authorization remains authoritative;
- additive D1 migration only;
- active map camera/draw state remains independent of server refresh;
- future Organization scope must be compatible with mutation authorization.

---
id: architecture-offline-sync
type: architecture
status: active
last_updated: 2026-08-24
related: [architecture-data, architecture-security, architecture-map]
source_of_truth_for: [offline-queue, synchronization, conflict-handling]
---

# Offline Synchronization

## Goal

A field user must not silently lose a manual Campaign/Task change because connectivity disappears or another device edits the same Campaign.

M4 also requires remote data to appear without a full website reload and without resetting the current MapLibre camera.

## M4 local-first behavior

The versioned Campaign snapshot remains in browser localStorage.

A normal local mutation:
1. updates React state immediately;
2. writes the updated snapshot to primary + backup localStorage;
3. queues the latest snapshot for an asynchronous authorized Worker `PUT` while the page is open;
4. on acknowledgement, stores the canonical server revision locally and in memory.

This remains an ordinary website. There is no service worker, installable PWA, background sync or offline basemap cache.

## Startup and access transition

The browser renders its local last-known data immediately so startup does not wait for D1.

When online:
- `?campaign=` selects the Campaign when present, otherwise the local Campaign id is used;
- an invite token in the URL fragment is redeemed once for an HttpOnly session and then removed from the URL;
- otherwise the browser resolves its existing session;
- only then are protected snapshot/version endpoints read;
- a newer authorized server snapshot updates React/localStorage in memory;
- materially different optimistic local data is preserved in the conflict backup before replacement.

A pre-M4 Campaign with no grants is not auto-claimed. It remains locally visible on browsers that already had the cache, but protected server synchronization stays unavailable until explicit secured bootstrap creates the first Admin grant.

## Revision polling and request volume

The browser keeps the last acknowledged server revision separately from optimistic local changes.

Writes send `baseRevision`; the Worker advances the revision only when that base still matches and the role is authorized for the proposed change.

Normal remote-update checks:
- approximately every **30 seconds** while the page is open and initialized;
- immediately after `online` returns;
- immediately when `visibilitychange` makes the tab visible again;
- immediately when the user presses **Daten aktualisieren / Refresh data**.

The normal poll calls only:

`GET /api/campaigns/:campaignId/version`

If the revision is unchanged, no snapshot is downloaded.

If the revision is newer and it is safe to apply, the browser then performs one snapshot GET and replaces the in-memory React Campaign state. SVG geometry updates from that state automatically.

No WebSockets are used in M4.

## No full-page reload

Remote synchronization must not call `window.location.reload()`.

Campaign snapshot state and MapLibre camera state are independent. Applying a newer snapshot must not:
- reset zoom;
- reset center;
- reset bearing;
- jump to the Germany fallback;
- automatically trigger GPS centering.

The personal camera is persisted separately and the existing MapLibre instance remains alive while React receives a new Campaign snapshot.

## Active draft/edit safety

A remote revision must never silently destroy unsaved local interaction state.

Unsafe-to-replace modes:
- `draw`;
- `edit`;
- `street-draw`.

When `/version` reports a newer revision during one of those modes:
1. remember that a newer server revision exists;
2. do **not** replace the current Campaign snapshot underneath the active interaction;
3. show compact “Neue Daten verfügbar / New data available” feedback;
4. retain all local draft/edit vertices;
5. after the user saves/cancels and returns to `browse`, fetch/apply the newer server state when no local write is pending.

The manual refresh button follows the same safety rule; pressing it while a draft is active may discover a newer revision but does not silently discard the draft.

This is intentionally smaller than M5's future durable mutation queue.

## Conflict/rejection behavior

There is no silent last-write-wins behavior.

If a snapshot write is rejected, unauthorized or returns HTTP 409:
1. preserve the rejected optimistic snapshot in `verteil-flyer:campaign-snapshot:conflict` when storage allows it;
2. expose a visible sync/access warning;
3. fetch the current authorized server snapshot when possible;
4. cache/load the server state without reloading the page.

If authorization was revoked, the browser clears its in-memory access state and further protected requests fail until another valid access link/session is supplied.

If the current server snapshot cannot be fetched, the optimistic local snapshot remains available on that device instead of being silently erased.

## Temporary connectivity loss

Ordinary transient failures keep the latest unsent snapshot in memory while the current page remains open and retry when connectivity returns. The localStorage primary/backup copy still protects the last local domain state across a normal reload.

M4 deliberately does **not** implement a durable multi-mutation queue, idempotency ledger or background sync.

## M5 durable queue direction

A later resilient synchronization milestone may:
1. store unsent mutations durably in browser storage such as IndexedDB;
2. give mutations idempotency keys;
3. retry across page reloads;
4. preserve ordering/reversal semantics for Undo;
5. expose pending/sync-error state more granularly;
6. replace complete-snapshot writes with narrower mutation-specific endpoints.

That work must keep the website-only constraint and must not add a service worker merely to queue mutations.

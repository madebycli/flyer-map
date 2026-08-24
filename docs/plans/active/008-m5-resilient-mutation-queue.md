---
id: plan-008-m5
type: plan
status: active
last_updated: 2026-08-24
---

# M5 — Resilient Mutation Queue + Synchronization Hardening

## Goal

Make allowed Campaign changes durable across transient/offline connectivity and reloads by replacing the normal client write path with an IndexedDB-backed mutation queue and Worker-enforced idempotent mutation endpoint, while preserving M4 authorization, the localStorage snapshot recovery cache, and the MapLibre/SVG renderer boundary.

## Relevant context

- PR #16 / `m4-access-links-ux-sync` is still open, so this branch is intentionally based on the completed M4 branch rather than `main`.
- **Merge ordering gate:** this M5 branch must not merge before M4. After PR #16 lands on `main`, rebase/retarget M5 cleanly onto current `main` before merge.
- M4 authorization remains mandatory on every protected read/write. Campaign id is only a selector.
- M4 still uses complete-snapshot PUTs and a coarse Campaign revision; M5 narrows the ordinary write path to explicit mutations.
- Existing localStorage primary/backup/conflict snapshots must be preserved as startup/recovery data.
- This remains a normal mobile-first website: no service worker, Background Sync API, Web App Manifest or installable PWA.
- MapLibre remains limited to CARTO Voyager Retina, camera/rotation/compass and local one-shot geolocation. All application geometry remains in the SVG overlay.
- Personal camera state is browser-local and never enters the mutation queue; shared Campaign `defaultMapView` may be mutated by Admin.

## Tasks

1. Add additive D1 migration `0003_m5_mutations.sql` for the server-side mutation/idempotency ledger; never rewrite `0001_initial.sql` or `0002_m4_access.sql`.
2. Define an explicit mutation envelope with mutation id/idempotency key, Campaign id, mutation type, payload, base revision, created timestamp and client retry metadata.
3. Model mutation types for Campaign rename/default map focus, Team create/update, Area create/rename/geometry/delete, Street Task create/status/delete.
4. Add Worker validation that rejects malformed/unknown mutations and validates the resulting domain state/geometry.
5. Add Worker mutation authorization preserving M4 Admin/Team Editor/Viewer rules, including scoped-team checks and revoked-session behavior.
6. Add atomic-ish revision claim + mutation ledger semantics so a repeated mutation id returns its already-applied result instead of applying twice; handle races by rechecking the ledger.
7. Keep existing snapshot endpoints for reads/recovery/transition, but move normal client writes to the mutation endpoint.
8. Add an IndexedDB-backed durable queue. Queue records survive reload and contain id, Campaign, type/payload, base revision, createdAt, retry/attempt state and lastError.
9. Apply allowed UI mutations optimistically to React/localStorage first, enqueue durably on explicit Save/action, then process sequentially while the page is open.
10. Re-run the queue on startup, `online`, visible-tab transition and manual refresh; use bounded exponential backoff and no tight polling loop.
11. On successful acknowledgement, remove the queue item, adopt the acknowledged revision and retain the confirmed snapshot cache.
12. Distinguish retryable connectivity/server failures from conflict (409), authorization/revocation (401/403), invalid mutation (400/422) and already-applied idempotent success.
13. Stop blind retries for revoked/forbidden access and conflicts; expose compact mobile sync state without blocking the map.
14. Keep draw/edit/street draft vertices local until explicit Save creates one durable mutation.
15. Add automated tests for persistence across reload, idempotency, offline-then-success, ordered mutations, Viewer/Team Editor boundaries, revoked access, conflicts, invalid mutation validation, TypeScript and production build.
16. Update `OFFLINE_SYNC.md`, `DATA.md`, `SECURITY.md`, `CURRENT.md`, deployment docs/context map as needed and add an ADR for the durable mutation/idempotency protocol.
17. Open a separate M5 PR. CI must be green, but any required production `0003` migration remains an explicit external gate and must not be represented as applied until confirmed.

## Acceptance criteria

- A queued mutation survives a page reload in IndexedDB and its optimistic Campaign state remains visible from the existing localStorage snapshot cache.
- Re-sending the same mutation id cannot create duplicate Areas/Tasks or apply a status/name change twice; the Worker returns the recorded successful result.
- Offline mutations are retried later in order and acknowledged without requiring a service worker or Background Sync API.
- Ordering is preserved for dependent mutations within a Campaign.
- Viewer writes fail server-side and are not retried forever.
- Team Editor mutations cannot modify another Team's Areas/Tasks or Campaign/Admin configuration.
- Revoked access stops queue processing with visible authorization state.
- A stale/conflicting mutation is not silently overwritten; it remains inspectable/visible as conflict state.
- Unknown/malformed mutation types/payloads are rejected by the Worker.
- Explicit geometry Save produces one mutation; intermediate vertex movements do not.
- Personal camera movement never creates a mutation; Campaign default map focus does.
- Existing local snapshots are not deleted by the M5 transition.
- Renderer boundary remains unchanged: no MapLibre application GeoJSON layers.
- Tests, TypeScript and production build are green.

## Risks

- D1 does not provide a long-lived application transaction around read/compute/write; revision claiming plus an idempotency ledger must be designed so concurrent retries cannot double-apply a mutation.
- Dependent offline mutations can carry an older base revision after an earlier queued mutation succeeds; the client must advance/rebase safe subsequent mutations rather than treating every sequential local edit as an external conflict.
- Mutations that target deleted/foreign-changed entities require explicit conflict semantics rather than reconstructing a whole client snapshot over newer server data.
- M5 depends on M4 code but must not enter M4 PR #16 or delay its production gate.

## Decisions made

- Use IndexedDB directly through a small local adapter rather than adding a large synchronization framework.
- Keep localStorage snapshots as fast startup/recovery state; IndexedDB is the durable source of unacknowledged mutations.
- Use a mutation-specific Worker endpoint with a server-side idempotency ledger and the existing Campaign revision as conflict metadata.
- Process one Campaign queue sequentially in creation order while the page is open; trigger retries from lifecycle/connectivity events plus bounded backoff.
- No service worker, Background Sync API, Web App Manifest, MapLibre application geometry layers or personal-camera synchronization.

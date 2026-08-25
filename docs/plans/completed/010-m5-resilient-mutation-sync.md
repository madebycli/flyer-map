---
id: plan-010-m5-resilient-mutation-sync
type: plan
status: completed
last_updated: 2026-08-25
related: [plan-009-product-platform-foundation, architecture-offline-sync, architecture-data, architecture-security, architecture-map, quality, ADR-0011]
---

# Plan 010 — M5 resilient mutation synchronization

## Goal

Make saved field changes durable during unreliable connectivity and preserve unacknowledged mutations in browser storage without introducing a Service Worker/PWA and without weakening Worker-side authorization.

The mutation queue may persist across browser reloads, but a cold page reload while completely offline is not an application-shell guarantee under the current website-only/no-Service-Worker architecture.

## Completed implementation

M5 was implemented on the existing branch `m5-resilient-sync-mainline` and merged through PR #24 on 2026-08-25.

Implemented architecture:
- explicit Campaign/Team/Area/Street mutations;
- IndexedDB durable queue for unacknowledged changes;
- emergency localStorage shadow during IndexedDB enqueue;
- stable mutation ids plus canonical SHA-256 fingerprints;
- ordered processing with bounded retry/backoff;
- online/visible-tab/manual retry triggers;
- explicit conflict, invalid and access-blocked states;
- Worker validation followed by existing authorization;
- narrow D1 writes plus mutation ledger;
- compact sync status UI;
- no Service Worker or Background Sync API.

ADR-0011 governs mutation queue/idempotency behavior.

## D1 migration

`migrations/0003_m5_mutations.sql` was applied successfully to remote `flyer-map-db` on 2026-08-25.

## Acceptance evidence

Passed automated and browser acceptance includes:
- loaded preview works;
- offline Street create/edit in an already-loaded app is stored locally;
- reconnect delivers queued work and returns to saved state;
- online reload confirms the intended change once without duplicate effect;
- same mutation id plus same content is server-idempotent;
- same mutation id plus changed content is rejected;
- conflicting target changes produce explicit conflict instead of silent overwrite;
- revoked/invalid access leaves queued work blocked instead of blind retry;
- transient retry metadata remains durable;
- SQL-/HTML-like user-controlled mutation text remains bound D1 data rather than SQL interpolation;
- saved Areas/Streets remain visible/selectable and active edit behavior remains correct;
- maximum-zoom CARTO basemap regression was fixed and browser-accepted;
- final branch GitHub CI and Cloudflare Workers build passed.

Final accepted M5 preview before merge:
- Worker Version ID `481a9209-61ff-4b06-83cb-844c4a567d9c`.

PR #24 merged to `main` as merge commit `f42dcd967bcd97f846d27fd284074ceda6237f86`.

## Maximum-zoom renderer regression

During M5 acceptance, the CARTO basemap became white at maximum zoom while saved geometry remained visible.

The fix kept MapLibre 5.7.1 and the existing provider/renderer architecture. Only the raster style layer maxzoom boundary was adjusted so the basemap remains visible at the configured map maximum zoom.

## Deferred cold-offline boundary

A full page reload while completely offline showed Chrome's normal offline/Dino page before application JavaScript could run.

This is not treated as mutation loss or user error. Guaranteed cold-offline app-shell startup remains outside M5 under ADR-0006.

Plan 011 covers deliberately prepared offline map data for an already-loaded website. A strict cold-offline application-shell requirement would require a separate ADR revisiting the website-only/service-worker boundary.

## Security properties preserved

- Campaign ids and mutation ids remain selectors/identifiers, never credentials;
- every protected mutation is authorized server-side by the Worker;
- Viewer remains read-only;
- Team Editor remains scoped to its Team;
- queued work does not contain plaintext access/session secrets;
- D1 user-controlled values use prepared/parameterized binding;
- mutation replay does not bypass access revocation.

## Explicit non-goals

- no Service Worker/PWA/Background Sync;
- no guaranteed cold offline app-shell load;
- no downloadable basemap package inside M5;
- no Organization/Comments/Statistics implementation;
- no MapLibre version upgrade;
- no saved-geometry renderer rewrite;
- no silent last-write-wins merge.

## Follow-up

The next dedicated connectivity/map slice is Plan 011, Prepared Offline Working Area. It requires an ADR selecting an offline-permitted OSM/OSM-derived source/format before implementation.

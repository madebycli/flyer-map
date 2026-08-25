---
id: plan-010-m5-resilient-mutation-sync
type: plan
status: active
last_updated: 2026-08-25
related: [plan-009-product-platform-foundation, architecture-offline-sync, architecture-data, architecture-security, quality, ADR-0011]
---

# Plan 010 — M5 resilient mutation synchronization

## Goal

Make saved field changes durable across reloads and unreliable connectivity without introducing a Service Worker/PWA and without weakening Worker-side authorization.

## Baseline / source of truth

This slice preserves:
- MapLibre GL JS 5.7.1 with saved Areas/Streets in persistent GeoJSON sources/layers;
- SVG only for active draw/edit geometry;
- Campaign-scoped Admin / Team Editor / Viewer access enforced by the Worker;
- localStorage Campaign snapshot as startup/recovery cache;
- coarse snapshot PUT only as compatibility/recovery path during the M5 transition.

Continue existing branch `m5-resilient-sync-mainline` / Draft PR #24. Do not create a parallel M5 branch. Old PR #17 is closed as superseded.

Relevant graph nodes: `offline-sync`, `data`, `security`, `quality`, `adr-m5-durable-mutations`, `plan-platform-roadmap`.

## Architecture

ADR-0011 governs this slice.

Implemented architecture:
- IndexedDB stores unacknowledged mutations;
- best-effort localStorage emergency shadow covers the short enqueue window;
- IndexedDB operations await transaction completion;
- mutation ids are stable idempotency keys;
- each id is bound to a canonical, locale-independent SHA-256 fingerprint of the validated mutation envelope;
- one explicit mutation is processed at a time per Campaign;
- Worker validates/applies against current state, reuses existing authorization, then performs narrow D1 persistence;
- D1 records mutation id/fingerprint/revisions in additive migration `0003`;
- same id + same content replays safely; same id + changed content is rejected;
- revision claim + narrow domain write + ledger insert use D1 `batch()` transaction semantics;
- conflict/auth/invalid states stop inappropriate retries;
- retryable failures use bounded exponential backoff;
- retry triggers include page initialization, `online`, visible-tab return and manual refresh;
- no Service Worker or Background Sync API.

## Implementation status

### A. Domain protocol — implemented
Explicit mutation types, derivation, target preconditions and tests are present.

### B. Durable browser queue — implemented; browser acceptance pending
IndexedDB queue, ordering, emergency recovery, transaction completion, retry/backoff and lifecycle triggers are present.

### C. Worker + D1 idempotency — implemented; D1 migration/runtime acceptance pending
Mutation route, validation, fingerprints, duplicate/reuse handling, authorization and narrow writes are present.

### D. User-visible sync state — implemented; field acceptance pending
Compact pending/syncing/offline/conflict/failed/access-blocked indicator is present without changing MapLibre lifecycle.

### E. Documentation / handoff — current
OFFLINE_SYNC, DATA, SECURITY, DEPLOYMENT, CURRENT, ADR-0011, context graph and NEW_AGENT are aligned to PR #24.

## Repository / preview acceptance — passed

Runtime-hardening head `8c7020ad5d1538bea68c351d918e94aa8f54973c`:
- CI #202 passed.

Complete code + context/ADR/runbook head `5c7dce819d472be8242da59034310d7a87c21f36`:
- CI #208 passed;
- Cloudflare exact commit preview deployment passed;
- exact preview: `https://bb8fa846-flyer-map.cloudflare-eleven035.workers.dev`.

Cloudflare PR bot explicitly reported `5c7dce81` as the successful preview commit.

Commits after `5c7dce...` are documentation/handoff/status-only at this point, so they are runtime-equivalent to the accepted preview. If any later commit changes runtime code, obtain a new exact preview before merge.

Automated tests cover:
- mutation derivation and target conflicts;
- durable queue order/reload abstraction;
- failed IndexedDB enqueue emergency recovery;
- localStorage emergency-shadow failure fallback;
- corrupt emergency-shadow quarantine;
- duplicate same-id/same-content apply-once behavior;
- same-id/changed-content rejection;
- canonical fingerprint stability;
- existing Team Editor / Viewer authorization policy.

## D1 migration status — current gate

`migrations/0003_m5_mutations.sql` is repository-prepared only and is **not yet claimed applied**.

Before mutation runtime/browser acceptance, explicitly apply `0003` to the D1 environment used by the preview/runtime acceptance. Do not intentionally call the mutation route before that migration exists in the bound database.

## Browser/field acceptance still required

After `0003` migration confirmation, test one gate at a time:
1. offline save -> reload -> reconnect -> queued mutation synchronizes;
2. retry/reconnect does not duplicate the effect;
3. conflicting target change is visibly surfaced and does not overwrite silently;
4. revoked/invalid access stops blind retry and queued work remains access-blocked;
5. transient network/server failure remains queued and later retries;
6. saved MapLibre Areas/Streets remain visible/selectable and active edit behavior is unchanged.

Record each observed result immediately in this plan and `CURRENT.md`.

## Risks

- legacy optimistic snapshots before queue initialization still rely on one-time compatibility recovery;
- unsupported compound snapshot diffs must fail visibly rather than falling back to broad ordinary writes;
- one terminal queue item blocks later dependent mutations by design;
- IndexedDB/private-mode limitations must surface as failed-save state;
- `0003` is not yet applied, so browser mutation acceptance cannot honestly begin yet.

## Explicit non-goals

- no Service Worker;
- no PWA/install flow;
- no Background Sync API;
- no Organization model;
- no Comments/Activity/Automations/Statistics implementation;
- no MapLibre version change;
- no rewrite of saved-geometry renderer;
- no silent last-write-wins merge.

## Immediate next

1. Keep PR #24 Draft.
2. Confirm final docs-only CI remains green.
3. Apply `0003_m5_mutations.sql` to the chosen D1 runtime-acceptance environment.
4. Complete the browser acceptance sequence above one gate at a time.
5. Merge only after remaining gates are passed and documented.

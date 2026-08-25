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

This slice starts from current `main` after merged PR #21 and preserves:
- MapLibre GL JS 5.7.1 with saved Areas/Streets in persistent GeoJSON sources/layers;
- SVG only for active draw/edit geometry;
- Campaign-scoped Admin / Team Editor / Viewer access enforced by the Worker;
- localStorage Campaign snapshot as startup/recovery cache;
- coarse snapshot PUT only as compatibility/recovery path during the M5 transition.

Relevant graph nodes:
- `offline-sync`;
- `data`;
- `security`;
- `quality`;
- `adr-m5-durable-mutations`;
- `plan-platform-roadmap`.

The old draft PR #17 is closed as superseded. It was based on a pre-PR21 branch and obsolete renderer assumptions; only isolated synchronization ideas were ported to the fresh post-PR21 branch.

Current implementation stays on existing branch `m5-resilient-sync-mainline` / Draft PR #24. A fresh agent must continue that PR rather than creating a parallel M5 branch.

## Architecture decisions

See ADR-0011.

Core direction:
- IndexedDB stores unacknowledged mutations;
- mutation ids are stable idempotency keys;
- each mutation id is bound to a canonical, locale-independent SHA-256 fingerprint of the validated mutation envelope;
- one explicit mutation is processed at a time per Campaign;
- Worker loads current state, validates/applies mutation in memory, reuses existing authorization policy, then performs narrow D1 persistence;
- D1 records applied mutation ids/fingerprints in additive migration `0003`;
- same id + same mutation may be replayed safely; same id + changed mutation is rejected;
- D1 `batch()` transaction semantics are relied on for atomic revision claim + narrow write + ledger insert; current Cloudflare docs state that a failing statement aborts/rolls back the whole batch;
- conflicts/auth failures remain visible terminal queue states;
- retryable failures use bounded exponential backoff;
- retries run on page startup, online, visible-tab return and manual refresh;
- no Service Worker or Background Sync API.

## Tasks

### A. Domain protocol — implemented
- explicit mutation envelope/types for Campaign, Team, Area and Street Task changes;
- mutation derivation from the existing snapshot-oriented UI save path;
- deterministic apply/conflict preconditions;
- validation/derivation tests.

### B. Durable browser queue — implemented, browser acceptance pending
- IndexedDB queue storage;
- ordered listing;
- queue states: pending/retry/conflict/blocked-auth/invalid;
- reload-safe enqueue before network delivery;
- emergency localStorage shadow during the enqueue window so a failed IndexedDB write can be recovered on the next page lifetime;
- emergency shadow is optional when localStorage itself is unavailable but IndexedDB succeeds;
- corrupt emergency shadow is quarantined instead of blocking the queue forever;
- IndexedDB read/write methods await transaction completion;
- bounded retry/backoff;
- retry triggers for online/visibility/manual refresh;
- localStorage snapshot retained as fast startup/recovery state.

### C. Worker + D1 idempotency — implemented, migration/runtime acceptance pending
- additive `migrations/0003_m5_mutations.sql`;
- mutation route `/api/campaigns/:id/mutations`;
- request validation and payload limits;
- canonical mutation fingerprint stored with the idempotency ledger;
- duplicate same-id/same-content request returns previous applied revision without reapplying;
- same id with changed content returns `mutation_id_reused`;
- existing Worker authorization remains authoritative;
- narrow D1 writes guarded by Campaign revision/write token;
- bounded re-evaluation on concurrent revision movement.

### D. User-visible sync state — implemented, field acceptance pending
- expose pending/syncing/offline/conflict/failed/access-blocked state with a compact mobile-first indicator;
- do not disturb MapLibre renderer/camera lifecycle.

### E. Documentation / deployment — implemented for current code state, acceptance notes remain active
- OFFLINE_SYNC, DATA, SECURITY, CURRENT, DEPLOYMENT and ADR-0011 describe the M5 implementation as code-in-PR, not production-deployed behavior;
- context graph routes current M5 work through Plan 010 and ADR-0011;
- NEW_AGENT points fresh sessions at existing PR #24/Plan 010;
- `0001`/`0002` remain immutable;
- `0003` must be explicitly applied before mutation runtime acceptance in the chosen D1 environment.

## Repository acceptance status

Runtime-hardening head: `8c7020ad5d1538bea68c351d918e94aa8f54973c`.

Passed:
- CI #202 on `8c7020ad...`;
- tests, TypeScript and production build all green in that run;
- mutation apply/derivation conflict tests;
- queue ordering and durable reload abstraction tests;
- failed IndexedDB enqueue emergency-shadow recovery test;
- localStorage emergency-shadow failure does not block a successful durable queue write;
- corrupt emergency-shadow quarantine test;
- duplicate same mutation id/content applies once;
- same mutation id with changed payload is rejected;
- canonical fingerprint remains stable across object key insertion order;
- Team Editor/Viewer authorization tests inherited from the current Worker policy remain green.

Complete code + context/ADR/runbook head `5c7dce819d472be8242da59034310d7a87c21f36` passed CI #208. Commits after that acceptance point are documentation/handoff-only unless PR history states otherwise; the latest final repository head must still be checked before merge.

## Cloudflare preview status — open

- exact preview confirmed for older head `fc200f9d4331d002fd73c060fd3c76636e69b0d2`;
- the Cloudflare PR bot record checked after CI #208 still names only `fc200f9d`;
- the coding environment cannot resolve the `workers.dev` host directly;
- therefore exact preview for the final runtime-equivalent M5 head is **not yet confirmed**.

Do not use the older `fc200f9d` preview as proof that the hardened fingerprint/emergency-queue runtime was deployed.

## D1 migration status — open

`migrations/0003_m5_mutations.sql` is repository-prepared only and includes the required mutation fingerprint column.

It is not claimed applied. The mutation endpoint must not be intentionally exercised in a D1 environment before `0003` is explicitly applied there.

## Acceptance still required before merge/production rollout

Repository/deployment:
- latest final repository head green;
- exact Cloudflare preview for the final runtime-equivalent head;
- explicit application of `0003_m5_mutations.sql` to the D1 environment used for runtime acceptance.

Browser/field:
- save while offline -> reload -> queued mutation still exists and later synchronizes;
- online/visibility/manual refresh retries without duplicate effects;
- conflict is visibly surfaced and does not silently overwrite server state;
- revoked access stops blind retry and leaves the queued mutation visible as access-blocked;
- retryable server/network failure retains the queued mutation and later retries;
- MapLibre saved Areas/Streets and active edit behavior remain unchanged by M5.

## Risks

- legacy optimistic snapshots created before queue initialization need a safe one-time recovery path;
- snapshot UI can occasionally change more than one domain operation at once; unsupported compound diffs must fail visibly rather than silently falling back to broad writes;
- queue order means one terminal conflict blocks later dependent mutations;
- IndexedDB may be unavailable/private-mode constrained on some browsers, which must surface as a visible failed-save state;
- migration `0003` is code-prepared but not yet claimed applied, so mutation runtime tests must not start against an unmigrated D1 database.

## Explicit non-goals

- no Service Worker;
- no PWA/install flow;
- no Background Sync API;
- no Organization model;
- no Comments/Activity/Automations/Statistics implementation;
- no MapLibre version change;
- no rewrite of the saved-geometry renderer;
- no silent last-write-wins conflict merge.

## Immediate next

1. Keep PR #24 Draft and verify CI on the latest documentation/handoff-only head.
2. Resolve the exact Cloudflare preview-head gate; do not claim the stale `fc200f9d` preview as current.
3. Apply `0003_m5_mutations.sql` to the chosen D1 runtime-acceptance environment only through the documented Cloudflare/Wrangler procedure.
4. Perform the browser queue/reconnect/conflict/revocation acceptance against an exact migrated preview/runtime-equivalent deployment.
5. Record each observed gate immediately in this plan + `CURRENT.md`; merge only after all remaining gates are passed.

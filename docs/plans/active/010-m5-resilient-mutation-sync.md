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
- `plan-platform-roadmap`.

The old draft PR #17 contains useful M5 experiments but is based on a pre-PR21 branch and an obsolete renderer description. It is reference material only; M5 is being ported onto a fresh branch from current `main` rather than merging that branch wholesale.

## Production-health note

The repository environment cannot resolve the public `workers.dev` hostname, so post-PR21 production health is still explicitly tracked in GitHub #23 and is not claimed passed.

The user explicitly instructed continued development on 2026-08-25. Therefore implementation may proceed on this isolated branch, but **M5 must not be merged/deployed to production until the normal production/migration gates are satisfied**.

## Architecture decisions

See ADR-0011.

Core direction:
- IndexedDB stores unacknowledged mutations;
- mutation ids are stable idempotency keys;
- one explicit mutation is processed at a time per Campaign;
- Worker loads current state, validates/applies mutation in memory, reuses existing authorization policy, then performs narrow D1 persistence;
- D1 records applied mutation ids in an additive `0003` ledger;
- conflicts/auth failures remain visible terminal queue states;
- retryable failures use bounded exponential backoff;
- retries run on page startup, online, visible-tab return and manual refresh;
- no Service Worker or Background Sync API.

## Tasks

### A. Domain protocol
- explicit mutation envelope/types for Campaign, Team, Area and Street Task changes;
- mutation derivation from the existing snapshot-oriented UI save path;
- deterministic apply/conflict preconditions;
- validation tests.

### B. Durable browser queue
- IndexedDB queue storage;
- ordered listing;
- queue states: pending/retry/conflict/blocked-auth/invalid;
- reload-safe enqueue before network delivery;
- bounded retry/backoff;
- retry triggers for online/visibility/manual refresh;
- retain localStorage snapshot as fast startup/recovery state.

### C. Worker + D1 idempotency
- additive `migrations/0003_m5_mutations.sql`;
- mutation route `/api/campaigns/:id/mutations`;
- request validation and payload limits;
- duplicate mutation id returns previous applied revision without reapplying;
- current Worker authorization remains authoritative;
- narrow D1 writes guarded by Campaign revision/write token;
- bounded re-evaluation on concurrent revision movement.

### D. User-visible sync state
- expose pending/syncing/offline/conflict/failed/access-blocked state to the existing UI with a compact mobile-first indicator;
- do not disturb MapLibre renderer/camera lifecycle.

### E. Documentation / deployment
- update OFFLINE_SYNC, DATA, SECURITY and CURRENT to actual implemented state;
- update context graph with Plan 010 + ADR-0011;
- keep `0001`/`0002` immutable;
- document that `0003` must be explicitly applied to production D1 before M5 production rollout.

## Acceptance

Automated/repository acceptance:
- mutation apply/derivation tests cover supported operations and conflict preconditions;
- IndexedDB abstraction tests prove order and durable-record semantics;
- duplicate server retry applies once;
- Viewer mutation rejected;
- Team Editor scope stays Worker-enforced;
- stale target edit returns explicit conflict;
- retryable/auth/invalid responses are classified correctly;
- repository `check` passes.

Browser/field acceptance before production rollout:
- save while offline -> reload -> queued mutation still exists and later synchronizes;
- online/visibility/manual refresh retries without duplicate effects;
- conflict is visibly surfaced and does not silently overwrite server state;
- revoked access stops blind retry;
- MapLibre saved Areas/Streets and active edit behavior remain unchanged by M5.

## Risks

- legacy optimistic snapshots created before queue initialization need a safe one-time recovery path;
- snapshot UI can occasionally change more than one domain operation at once; unsupported compound diffs must fail visibly rather than silently falling back to broad writes;
- queue order means one terminal conflict blocks later dependent mutations;
- IndexedDB may be unavailable/private-mode constrained on some browsers, which must surface as a visible failed-save state.

## Explicit non-goals

- no Service Worker;
- no PWA/install flow;
- no Background Sync API;
- no Organization model;
- no Comments/Activity/Automations/Statistics implementation;
- no MapLibre version change;
- no rewrite of the saved-geometry renderer;
- no silent last-write-wins conflict merge.

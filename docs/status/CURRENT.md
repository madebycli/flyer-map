---
id: status-current
type: status
status: active
last_updated: 2026-09-05
---

# Current Project State

## Preferred product foundation

The current general product foundation is:

`foundation-verified-rxdb-brainrot`

It was created directly from the exact verified RxDB staging reference:

`mission-rxdb-staging@4fc12270ff948ba246dd0c804076720cc65f37b8`

That staging reference must remain available as safety/evidence history. Do not delete, reset or repurpose it merely to simplify branches.

The foundation preserves the verified RxDB/Street/MapLibre state and adds the complete product-side Brainrot/Funny long-hold mode from `fun/menu-hold-xxl-runner` without copying the Funny-specific Cloudflare preview environment.

Durable branch/integration context lives in `docs/context/BRANCH_CONVERGENCE.md`.

## RxDB / realtime / renderer baseline

Current architecture remains:

```text
UI/domain mutation
-> RxDB/Dexie local replica
-> authenticated Worker Pull/Push
-> canonical D1 commit + rxdb_sync_changes
-> optional Campaign Durable Object/WebSocket changed hint
-> incremental Pull/checkpoint recovery
-> RxDB/read model
-> React
-> MapLibre
```

Collections:

- `campaigns`
- `teams`
- `areas`
- `streetTasks`
- `houseTasks`

Critical fixes that must not regress:

- browser `fetch` is bound correctly for RxDB transport;
- prepared-Street post-commit realtime notification remains inside the Worker lifecycle;
- MapLibre live source updates must not permanently drop React state transitions during transient style loading;
- D1/Worker remain authoritative; browser and Durable Object are not canonical data stores.

The historical Staging evidence includes isolated deployment/migration checks, real Chromium two-browser synchronization and the visible MapLibre Street lifecycle gate.

## Brainrot/Funny mode

The foundation contains:

- `src/platform/FunnyFocusVideo.tsx`
- `src/platform/funny-focus-video.css`
- `src/main.tsx` integration
- `tests/funnyFocusVideoContract.test.ts`

It is a local-only UI feature: five-second menu-button hold, alternating configured focus clips, no Campaign/RxDB/API persistence, and no LocalStorage/IndexedDB state.

## Organizer/Admin remains parallel

Current known Organizer/Admin source head at this update:

`feature/organizer-admin-platform@46931e119f23a5ba5bea44a174944c215e06ae0b`

PR #76 remains OPEN + DRAFT + UNMERGED against `mission-rxdb-sync`.

Do not integrate Organizer/Admin into the product foundation until the user explicitly declares the Admin panel ready. At that point, first perform a read-only branch/convergence audit and create an integration plan from the then-current foundation.

## Established Street/House engine remains later work

Current known source:

`feature/established-street-preparation-engine@501b8058302342358c8eaed5c67e378b02deb0c0`

This is an older parallel lineage. Later work should selectively port its valuable preparation engine semantics/modules onto the modern RxDB foundation rather than making the old branch the new base.

## Safety boundaries

Without explicit new user approval:

- no Production deploy;
- no Production D1 migration;
- no PR #74 merge or Ready-for-Review transition;
- no PR #76 merge;
- no replacement of staging isolation with Funny preview configuration;
- no deletion/reset of the verified staging reference;
- no wholesale merge of the old Street/House engine;
- no hidden suppression of sync errors instead of root-cause fixes.

## Current planning state

Active plan:

`docs/plans/active/029-verified-rxdb-brainrot-foundation.md`

Fresh planner handoff:

`docs/prompts/CONTINUE_VERIFIED_RXDB_FOUNDATION.md`

Next major convergence gate:

1. verify this Foundation exact head with CI/tests;
2. keep Admin development independent until explicitly declared ready;
3. when Admin is ready, audit and plan its integration onto the current Foundation;
4. after stable Admin convergence, plan the Street/House preparation-engine port unless priorities change.

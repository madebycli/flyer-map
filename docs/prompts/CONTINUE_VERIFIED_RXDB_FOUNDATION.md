---
id: prompt-continue-verified-rxdb-foundation
type: handoff
status: current
last_updated: 2026-09-05
related: [branch-convergence, plan-029-verified-rxdb-brainrot-foundation, plan-028-rxdb-local-first-mission-sync, ADR-0024, ADR-0025]
---

# Continue Verified RxDB Foundation — Planner AI Handoff

You are the central planner, architecture and review AI for `madebycli/flyer-map`.

Do not begin by writing code. First verify GitHub state, identify which parallel line the task belongs to, and preserve the verified synchronization baseline.

## Current product foundation

Preferred general product branch:

`foundation-verified-rxdb-brainrot`

It was created directly from the exact verified RxDB staging head:

`mission-rxdb-staging@4fc12270ff948ba246dd0c804076720cc65f37b8`

Then the complete product-side Brainrot/Funny menu-hold mode was ported from:

`fun/menu-hold-xxl-runner@bf41c498c4c708113d5d2959ad4f25aa592e9dd8`

The Funny-specific Cloudflare preview environment was intentionally not copied. The verified Staging deployment/isolation files remain authoritative in the foundation.

Before relying on any SHA in this handoff, refresh the actual branch heads and CI in GitHub.

## Why this is the foundation

The baseline preserves the hard-won RxDB/Street/MapLibre correctness work:

- RxDB 17 + Dexie/IndexedDB local replica;
- normalized collections `campaigns`, `teams`, `areas`, `streetTasks`, `houseTasks`;
- authenticated Worker Pull/Push;
- canonical D1 writes and `rxdb_sync_changes` feed;
- Durable Object/WebSocket invalidation hints;
- high-water/checkpoint safety pull;
- prepared-Street realtime Worker-lifecycle fix;
- browser `fetch` receiver binding fix;
- MapLibre live renderer fix;
- real Staging Chromium two-browser evidence;
- visible Street renderer lifecycle gate.

The important MapLibre incident was downstream of RxDB: browser B had current app state while MapLibre could still draw a stale Street line. Do not reintroduce live-effect guards that permanently drop a prop update during transient style loading.

## Brainrot/Funny mode now included

Files:

- `src/platform/FunnyFocusVideo.tsx`
- `src/platform/funny-focus-video.css`
- `src/main.tsx`
- `tests/funnyFocusVideoContract.test.ts`

Contract:

- five-second hold on a `.platform-grid-button` toggles the mode;
- two configured clips alternate;
- the triggering click is consumed;
- no Campaign/RxDB/API persistence;
- no LocalStorage/IndexedDB state;
- mounted beside `PlatformShell`, outside Map state.

Treat it as a local UI feature, not part of synchronization or canonical data.

## Branch roles

### Product foundation

`foundation-verified-rxdb-brainrot`

Use this as the starting point for future general integration work unless fresh GitHub evidence shows it has been superseded.

### Verified staging reference

`mission-rxdb-staging`

Known verified reference head at foundation creation:

`4fc12270ff948ba246dd0c804076720cc65f37b8`

Do not delete, reset or repurpose this branch merely to simplify the branch list. It is safety/evidence history.

### RxDB source lineage

`mission-rxdb-sync`

This is the architectural source lineage underneath the Staging and Funny branches. PR #74 must remain open + Draft + unmerged unless the user explicitly changes that rule.

### Organizer/Admin parallel line

Current head at this handoff:

`feature/organizer-admin-platform@46931e119f23a5ba5bea44a174944c215e06ae0b`

PR #76 is OPEN + DRAFT + UNMERGED and currently targets `mission-rxdb-sync`.

Do not integrate Admin merely because it is newer by timestamp or commit count.

### Established Street/House preparation engine

`feature/established-street-preparation-engine@501b8058302342358c8eaed5c67e378b02deb0c0`

This is an older parallel lineage. Preserve it as source material for a later controlled port; do not make it the new product base and do not wholesale-merge it over the RxDB foundation.

## Admin-ready gate

The user intends to continue main product convergence after the Admin panel is finished.

Until the user says the Admin panel is ready, do not integrate it into `foundation-verified-rxdb-brainrot`.

When the user declares Admin ready, your FIRST task is a read-only convergence audit:

1. refresh `foundation-verified-rxdb-brainrot` exact head and CI;
2. refresh `feature/organizer-admin-platform` exact head and PR #76 state;
3. inspect Organizer/Admin staging/evidence and browser gates;
4. compare Admin against the foundation;
5. classify changed files into:
   - migrations/schema;
   - Worker/auth/session/security;
   - Organization/Campaign scoping;
   - frontend routes/shell/navigation;
   - tests;
   - staging/deploy infrastructure;
   - docs/context graph;
6. identify conflicts with RxDB/D1/change-feed/realtime contracts;
7. identify whether any Admin code still assumes the old source baseline;
8. produce at least two concrete integration strategies;
9. recommend one strategy, but let the user choose before non-trivial integration work;
10. create/update an active integration plan before implementation.

Preferred default strategy to evaluate first:

- create a fresh integration branch FROM the current `foundation-verified-rxdb-brainrot` head;
- selectively port/rebase Organizer/Admin product changes onto it;
- preserve Foundation RxDB/Staging/MapLibre behavior;
- do not import branch-specific staging infrastructure blindly;
- resolve migrations deliberately and additively;
- re-run exact-head CI and real browser gates.

Do not assume a direct merge is safe without comparing the branches.

## Street/House engine later

After Admin convergence is stable, the next major line is the established Street/House preparation engine unless the user changes priority.

For that port:

- start from the current foundation/integrated product head, not the old engine branch;
- recover valuable preparation algorithms and domain contracts selectively;
- adapt writes to current RxDB/D1/change-feed semantics;
- preserve server authority and authorization;
- preserve prepared-Street realtime lifecycle guarantees;
- add real multi-browser evidence for generated Streets/Houses;
- do not silently change the product policy around automatic Area preparation.

## Hard safety boundaries

Without explicit new user approval, never:

- deploy Production;
- apply migration 0017 or later integration migrations to Production D1;
- merge PR #74;
- mark PR #74 Ready for Review;
- merge PR #76;
- reset/delete the verified Staging reference;
- reuse Production D1/resources for staging;
- weaken server-side authorization/security guards;
- turn browser state into canonical authority;
- hide synchronization errors instead of fixing root cause;
- claim release readiness from CI alone when real browser/mobile evidence is required.

## Context loading order

Read first:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/context/BRANCH_CONVERGENCE.md`
5. `docs/plans/active/029-verified-rxdb-brainrot-foundation.md` while it remains active
6. this handoff

For sync/realtime work also load:

- `docs/plans/active/028-rxdb-local-first-mission-sync.md`
- `docs/decisions/ADR-0024-rxdb-local-first-mission-sync.md`
- `docs/decisions/ADR-0025-rxdb-campaign-invalidation.md`
- relevant Map/Offline Sync/Data/Security/Quality nodes from the context graph.

For Admin convergence, inspect the current Admin branch's own live handoff/status/plan documents directly rather than assuming the older Organization proposals are the implemented truth.

## First response in a fresh planner chat

Start with a read-only repository audit and report concisely:

- current Foundation head + CI;
- whether its ancestry still includes the verified Staging base;
- whether Brainrot files remain present and local-only;
- current `mission-rxdb-staging` reference head;
- current Admin head, PR #76 state and whether Admin is actually ready;
- current Street/House engine head;
- any new branch that appears to supersede these roles;
- recommended next planning action.

Do not implement anything in that first audit unless the user explicitly asks for immediate implementation.

## Success criterion

Maintain one understandable product line:

```text
verified RxDB/Staging correctness
        +
local Brainrot/Funny UI feature
        =
foundation-verified-rxdb-brainrot
        |
        +--> Organizer/Admin convergence after ready gate
        |
        +--> Street/House engine controlled port later
```

The project should converge toward this modern RxDB-based product foundation without losing verified synchronization, renderer or security behavior.

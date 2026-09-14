---
id: ADR-0032
title: Central client sync coordinator with collection-aware push-proof barriers
status: accepted
date: 2026-09-14
related: [ADR-0011, ADR-0024, ADR-0025, ADR-0029]
---

# ADR-0032: Central client sync coordinator with collection-aware push-proof barriers

## Context

`unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944` could read a canonical checkpoint and start a pull before an already accepted local RxDB write had reached the server. The client already tracked `pendingPushProofs`, but `refresh()` and `refreshAndWait()` did not use those proofs as an ordering barrier.

The historical regression was restored as `tests/rxdbRefreshOrdering.test.ts`. CI run `34865295021` failed on the baseline-derived test commit with the assertion that refresh completed while a local write was still waiting for its push gate. The P0 is therefore reproduced, not inferred.

A first implementation used one global pending-write barrier for every refresh. CI run `34866065831` rejected that design because a retryable `teams` push blocked an unrelated `streetTasks` pull. Global automatic barriers are therefore explicitly rejected.

## Decision

`MissionRxdbSync` is the single owner of client sync ordering. `campaignStore` does not regain a second `serverWritePending` truth.

### Automatic and invalidation-driven refresh

`refresh(names)` is collection-aware:

1. Flush only the persistence gates relevant to the requested collections.
2. For each requested collection, inspect pending push proofs belonging to that collection.
3. Collections without a pending same-collection write may re-sync immediately.
4. A collection with a pending write is queued independently until its own push proof is resolved or the bounded barrier fails.
5. A blocked `teams` collection must not prevent `streetTasks`, `areas`, `houseTasks` or `campaigns` from advancing when those collections are safe.
6. Duplicate refresh triggers for the same blocked collection coalesce behind one barrier.

WebSocket, online/visibility and safety paths may continue to call the public coordinator API. They do not call a second store-level ordering mechanism.

### Explicit convergence refresh

`refreshAndWait()` is deliberately stronger. It represents the user-visible statement that all already accepted local work has converged, so Phase A waits for pending writes in all five mission collections before reading the target checkpoint and delegating to the existing checkpoint convergence logic.

This is intentionally not yet the final continuous-edit algorithm. A future Phase B may close a local proof-generation watermark so writes created after that watermark belong to the next round and cannot starve the closed round.

### Core/facade split

The existing RxDB replication mechanics remain in `rxdbMissionSyncCore.ts`. `rxdbMissionSync.ts` is the public coordinator facade. Source-contract tests read both files as one contract where they intentionally inspect implementation text.

## Conflict policy

Existing property-level Three-Way detection in `rxdbMutationAdapter` remains the baseline. Independent fields may rebase. Structural changes and unresolved same-field conflicts return canonical master state plus diagnostics. Stale updates against a deleted target remain `target_deleted` and do not recreate the entity.

No global CRDT is introduced.

The exact product rule for simultaneous status writes remains open: keep the current server-ordered conflict behavior or expose a user-visible domain conflict. Any change requires a separate decision and regression tests.

## Verification

Phase A is verified on head `d276ccdd6c2350997d3fdd377fb28824e56fd88d`:

- historical delayed-push refresh regression passes;
- existing regression `a retryable Team push does not block an independent Street pull` passes;
- full tests pass in CI run `34867857864`;
- TypeScript typecheck passes in the same run;
- dependency audit passes in the same run;
- production build passes in the same run;
- independent StreetEngine audit run `34867857844` passes.

No deployment or D1 migration was performed.

## Consequences

- A same-collection invalidation pull cannot overtake an already accepted local write in that collection.
- An unrelated broken collection no longer has to freeze the whole replica.
- Explicit convergence is truthful with respect to already accepted local writes.
- The P0 fix requires no schema migration.
- Per-collection health and a future watermark/rebase round can build on the same coordinator boundary.

## Rejected alternatives

### Store-level `serverWritePending` as primary guard

Rejected because it duplicates RxDB replication state and can be bypassed by realtime and safety paths.

### One global barrier for every automatic refresh

Rejected by regression evidence. It makes an unhealthy collection block independent collections.

### Wait forever for `pendingPushProofs.size === 0`

Rejected as the final continuous-edit model. New edits can arrive continuously. Phase A uses bounded waits; Phase B should use a closed proof-generation watermark if starvation is observed or a stronger round contract is required.

### One-minute global upload batch

Rejected because it increases collaboration latency and failure blast radius. Existing short type-specific coalescing windows remain preferable.

### Global CRDT

Rejected. Flyer Map is primarily server-authoritative status, geometry and derived data. CRDT complexity is justified only for future fields that truly require commutative concurrent editing.

## Remaining gates

- explicit test for automatic same-collection refresh delayed by a pending local push;
- multi-client same-status product decision and test;
- browser restart plus pending-write recovery across actor scopes;
- feed retention/bootstrap floor and delete-resurrection tests across compaction;
- full Area resize/delete versus active StreetEngine generation chaos tests.

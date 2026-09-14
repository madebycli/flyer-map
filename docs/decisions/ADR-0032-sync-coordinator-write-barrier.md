---
id: ADR-0032
title: Central client sync coordinator with push-proof barriers
status: proposed
date: 2026-09-14
related: [ADR-0011, ADR-0024, ADR-0025, ADR-0029]
---

# ADR-0032: Central client sync coordinator with push-proof barriers

## Context

`MissionRxdbSync.refreshAndWait()` on `unstable@35e9987` reads a server checkpoint before proving that already accepted local RxDB writes have reached the canonical server. Manual refresh, online/visibility transitions and realtime/safety invalidation can therefore schedule pulls without one shared write barrier.

A historical branch fixed the symptom with both `campaignStore.serverWritePending` and `MissionRxdbSync.waitForPendingPushes()`. Reintroducing both creates two owners for the same sync state.

## Decision

`MissionRxdbSync` is the single owner of client sync ordering.

1. Every local mutation that produces an RxDB push proof receives a monotonically increasing local proof generation.
2. A hard sync barrier closes a watermark at the current proof generation.
3. Debounced persistence gates are flushed.
4. The barrier waits only for pending proofs at or below that watermark to reach ACK/conflict/rejection or a bounded timeout.
5. Only after that barrier does it request the canonical server checkpoint.
6. Pull then advances all relevant collection checkpoints to that target.
7. Local edits created after the watermark belong to the next logical round and do not make the closed round unbounded.

`campaignStore` must not maintain a second `serverWritePending` truth. UI state may display coordinator status, but ordering remains in `MissionRxdbSync`.

WebSocket messages remain contentless invalidation hints. Lost/duplicate/out-of-order hints do not affect correctness. Safety recovery is allowed, but it also routes through coordinator semantics.

## Conflict policy

Existing property-level Three-Way detection in `rxdbMutationAdapter` remains the baseline. Structural changes and unresolved same-field conflicts return canonical master state plus diagnostic rejection/conflict information. CRDT is not introduced globally.

The exact product rule for concurrent status writes remains open: server-ordered status LWW versus explicit user-visible conflict. It must be decided and covered by tests before changing current behavior.

## Consequences

- a refresh cannot truthfully report convergence before pre-barrier local writes are server-resolved.
- continuous edits after the barrier do not starve a manual sync round.
- one coordinator owns manual/online/visibility/realtime/safety ordering.
- no schema migration is required for the P0 barrier.
- later per-collection health and round diagnostics can build on the same coordinator.

## Rejected alternatives

### Store-level `serverWritePending` as primary guard

Rejected as the architecture owner. It duplicates RxDB replication state and is easy to bypass from WebSocket/safety paths.

### Wait until `pendingPushProofs.size === 0`

Rejected as the final model because new edits can arrive continuously and keep an already closed manual barrier open forever.

### One-minute global upload batch

Rejected. It increases collaboration latency and failure blast radius. Use short type-specific coalescing windows instead.

### Global CRDT

Rejected. Flyer Map has mostly server-authoritative status, geometry and derived-data invariants. CRDT complexity is only justified for future fields that truly need commutative concurrent editing.

## Verification gates

- regression: refresh while accepted local push is delayed.
- refresh target includes the acknowledged local mutation.
- new writes after barrier watermark do not block the prior barrier forever.
- manual, online, visibility, WebSocket and safety triggers share coordinator semantics.
- lost/duplicate hints still converge through checkpoint pull.
- full CI, typecheck and build green before promotion.

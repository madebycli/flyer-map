---
id: ADR-0032
title: Central client sync coordinator with collection-aware push-proof barriers
status: accepted
date: 2026-09-14
related: [ADR-0011, ADR-0024, ADR-0025, ADR-0029]
---

# ADR-0032: Central client sync coordinator with collection-aware push-proof barriers

## Context

`unstable@35e9987efcf7a113a93df22b47f6f828cd0a4944` could read a canonical checkpoint and start a pull before an already accepted local RxDB write had reached the server. The client already tracked `pendingPushProofs`, but refresh orchestration did not enforce their ordering.

The historical regression `tests/rxdbRefreshOrdering.test.ts` was restored. The baseline-derived test failed with `refresh must not report current while the local write is still waiting for its push gate`, proving the race.

A first global barrier was also rejected by test evidence because a retryable `teams` push blocked an unrelated `streetTasks` pull.

## Decision

`MissionRxdbSync` is the single owner of client sync ordering. No second store-level `serverWritePending` truth is introduced.

### Automatic and invalidation-driven refresh

`refresh(names)` is collection-aware:

1. Flush persistence gates only for requested collections.
2. Inspect pending push proofs for each requested collection.
3. Safe collections may re-sync immediately.
4. A collection with a pending write waits independently for its own proof.
5. Duplicate refresh triggers for one blocked collection coalesce.
6. A broken Team push must not freeze Street, Area, House or Campaign pulls.

### Explicit convergence refresh

`refreshAndWait()` is intentionally stronger:

1. flush all relevant mission gates;
2. wait for all already accepted mission writes;
3. read the canonical target checkpoint;
4. pull to that target;
5. only then report convergence.

A proof-generation watermark remains optional future work if continuous editing can starve a bounded explicit round. It is not required for the verified current behavior.

## Expired change-feed checkpoint

A retained-feed expiry is not treated as a transient retry.

The server returns `rxdb_checkpoint_expired` when the client's checkpoint is below the retained floor. Recovery is:

```text
stop combined replications
-> start push-only replication for every collection
   using the exact same replicationIdentifier
-> awaitInSync on those recovery drains only
-> cancel drains
-> close local Mission RxDB
-> remove local Mission DB and stored checkpoints
-> full bootstrap from canonical server state
-> restart normal replications
```

The push-only drain happens before destructive local reset so durable offline writes survive browser restart and cannot be replaced by an older canonical pull.

RxDB 17.5 behavior was proven by a standalone restart test: pending push state survives reopening and is resumed by push-only replication with the same identifier.

### Multi-tab safety boundary

Normal multi-tab leader election and leader handover are proven. The destructive expired-checkpoint reset has not separately proven a second already-open tab during `removeRxDatabase()`.

Therefore this ADR explicitly does **not** authorize aggressive automatic physical change-feed GC. Retention-floor semantics may reject an irrecoverably old checkpoint, but production feed compaction remains gated on a coordinated multi-tab rebootstrap protocol/test.

## Authentication continuity

Campaign-admin access sessions remain 12h. A long-lived open RxDB page may cross that boundary while five collection requests are in flight.

The public coordinator wraps its HTTP transport with a singleflight remembered-device refresh:

```text
N parallel requests receive 401 access_required
-> exactly one /admin-accounts/session/refresh request
-> rotating trusted-device token is consumed once
-> all N wait for the same refresh result
-> each original request retries at most once
```

This avoids legitimate parallel collection traffic tripping trusted-device replay detection.

## Conflict policy

Existing property-level Three-Way detection remains authoritative:

- independent fields may rebase;
- unresolved same-field changes conflict;
- server-owned structural fields remain protected;
- stale update against deleted target remains `target_deleted`;
- no global CRDT is introduced.

The product rule for simultaneous same-status changes remains a separate decision if UX needs to expose the conflict differently.

## Verification

Current verified runtime head: `05857c6e254f3a4524a71bff49097a0aa820d699`.

- CI #1671 / run `34896353117`: tests, Typecheck, dependency audit and production build all PASS.
- Independent StreetEngine scale audit #98 / run `34896353122`: PASS.
- `unstable` remained on baseline `35e9987efcf7a113a93df22b47f6f828cd0a4944` during verification.

No deploy, production migration or production D1 action occurred.

## Consequences

- Pull cannot overtake an already accepted same-collection local write.
- An unrelated unhealthy collection does not freeze the whole replica.
- Explicit convergence is truthful for already accepted writes.
- Expired-checkpoint recovery preserves durable local intent before canonical bootstrap.
- Compacted deletes do not resurrect in the proven restart E2E path.
- Long-lived campaign-admin/RxDB sessions can renew via a rotating trusted device without converting the 12h access session into a long-lived cookie.
- Physical feed GC remains disabled until the multi-tab destructive-reset gap is closed.

## Rejected alternatives

### Store-level pending flag

Rejected because it duplicates RxDB state and can be bypassed by realtime/safety paths.

### Global automatic pending barrier

Rejected by regression evidence because one unhealthy collection blocks independent collections.

### Wait forever for all pending proofs

Rejected because continuous edits can starve a global wait. Current waits are bounded.

### Delete local replica before push drain

Rejected because durable offline intent could be lost or a stale state could be resurrected.

### New replication identifier for recovery

Rejected because RxDB's durable pending push metadata is keyed by the existing replication identity.

### Long-lived access cookie

Rejected. Access sessions stay 12h; remembered-device credentials rotate separately and are revocable.

## Remaining gates

- coordinated multi-tab destructive rebootstrap before automatic physical feed GC;
- real Cloudflare D1 `meta.rows_read` / `meta.rows_written` measurement before a Free-Tier verdict;
- optional product decision for simultaneous same-status UX semantics.
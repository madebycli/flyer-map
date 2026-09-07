---
id: ADR-0024
title: RxDB local-first mission synchronization
status: accepted
date: 2026-09-02
related: [ADR-0011, ADR-0022, ADR-0023, plan-028-rxdb-local-first-mission-sync]
---

# ADR-0024: RxDB local-first mission synchronization

## Context

The M5 browser queue serializes all Campaign mutations behind one terminal or
slow record. That is the wrong failure domain for a live mission with roughly
50 to 60 devices: a conflicted Team edit must not stop Street/House reads or
status convergence.

## Decision

The `mission-rxdb-sync` branch uses RxDB 17 with its Dexie/IndexedDB storage as
the browser replica. Five normalized collections are replicated separately:
`campaigns`, `teams`, `areas`, `streetTasks`, and `houseTasks`. React and
MapLibre consume a materialized read model from those collections; there is no
second map renderer.

D1 remains canonical. Worker pull/push endpoints resolve normal Campaign
access first. Pushes are adapted into existing narrow domain mutations and use
the existing validation, authorization, idempotency ledger and guarded D1
transaction. An additive `campaign_sync_changes` feed provides monotonic,
paginated checkpoints and tombstones. It is written within that same guarded
transaction only after migration 0017 exists.

Campaign and Team text/color replication uses a 900 ms trailing persistence
gate, with explicit blur, Enter and sheet-close flushing. Street/House status
writes are not delayed. RxDB leader election is used for multi-tab I/O; no
Service Worker or Background Sync API is introduced. ADR-0025 adds an optional
same-origin Durable-Object WebSocket invalidation hint; it carries no data and
never replaces authenticated HTTP pull/push or D1 authority.

The former M5 queue is read only for a one-time guarded import. Replayable
status and simple Team/Campaign intents enter RxDB only after a local canonical
Campaign document exists. Unsafe structural records are archived locally rather
than blindly replayed. Normal operation never starts the M5 network writer.
The established Collection/Pickup URL remains a separate specialized mutation
surface and keeps its existing online mutation endpoint; it is not part of the
five distribution collections.

## OSS and dependency decision

RxDB core, HTTP replication and Dexie storage are Apache-2.0 and can use the
custom same-origin Worker endpoint without RxDB Cloud or another paid SaaS.
The selected locked versions are `rxdb@17.5.0` and `rxjs@7.8.2`; RxDB supplies
the compatible Dexie storage dependency. The paid RxDB plugins remain out of
scope. This is the smallest viable local-first choice after rejecting a larger
hand-written extension of the M5 queue.

## Consequences and gates

This ADR supersedes ADR-0011 for the new Mission RxDB branch only. Existing
release/rollback branches retain their M5 behavior. Migration 0017 is prepared
locally but must not be applied remotely by application code. Before any
release: review the migration, apply it through the approved workflow, run CI
on the exact pushed head, verify the preview and perform two-browser plus
Android/iPhone offline/reconnect smoke tests.

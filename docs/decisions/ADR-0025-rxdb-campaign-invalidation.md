---
id: ADR-0025
title: RxDB Campaign invalidation over a Durable Object WebSocket
status: accepted
date: 2026-09-02
related: [ADR-0024, ADR-0011, plan-028-rxdb-local-first-mission-sync]
---

# ADR-0025: RxDB Campaign invalidation over a Durable Object WebSocket

## Context

RxDB HTTP replication is the canonical delivery path, but a live mission should
not wait for a collection poll to learn that another device committed a change.
The notification channel must remain safe when a browser disconnects, a message
is duplicated, or the Durable Object is evicted.

## Decision

After a successful guarded D1 mutation and change-feed commit, the Worker sends
the Campaign's highest feed sequence to one `CampaignSyncDurableObject`. The
object uses the Workers WebSocket Hibernation API to broadcast only
`{"type":"changed","seq":1234}`. It stores no Campaign documents, secrets,
authorization state or domain mutations. A notification is a hint, not a write
permission and not a source of truth.

The authenticated Worker owns the WebSocket upgrade route. The browser receives
the signal and asks the existing authenticated RxDB Pull endpoints to catch up;
the pull checkpoint remains authoritative. Duplicate or out-of-order signals
are harmless. Disconnect/reconnect starts from the client's per-collection
checkpoints, and a single Campaign-level HTTP checkpoint is checked every 45
seconds as a safety net. Visible/online transitions also call `refresh()`.

The DO has no idle timer or polling loop. There is one DO instance per Campaign,
configured through the local Wrangler Durable Object binding and migration tag.
The binding is not a D1 migration and no production migration/deploy is
performed by this branch.

## Consequences and gates

This supersedes the initial ADR-0024 statement that no WebSocket/DO transport
was present; ADR-0024's OSS, five-collection, D1-canonical and authorization
decisions remain unchanged. Deterministic tests cover normal signals,
duplicates, disconnect/reconnect, internal-only notifications, missed-signal
safety pull and non-duplicating domain materialization. Real two-browser,
Android and iPhone offline/reconnect smokes remain external release gates.

---
id: prompt-continue-rxdb-sync-latest
type: handoff
status: current
last_updated: 2026-09-02
related: [plan-028-rxdb-local-first-mission-sync, ADR-0024, ADR-0025]
---

# Continue RxDB Sync

## Branch and baseline

- Branch: `mission-rxdb-sync`
- Baseline: `mission-release-2026-09-02-manual`
- Baseline head: `5e7148d2a32f6237861e7e6a05e022eeb67c91ce`
- PR #73: open, Draft, unmerged
- Current feature head: `d0e8872` (`feat: add campaign websocket invalidation`)

## Completed

- RxDB 17.5.0 plus RxJS 7.8.2, Dexie storage, five normalized collections.
- Worker pull/push routes with Campaign access, Field Group filtering, Viewer guard,
  per-document conflict/rejection handling and retryable 5xx/schema failures.
- D1 change-feed migration 0017 prepared locally, scoped monotonic checkpoints,
  canonical upsert/delete documents and guarded same-transaction feed writes.
- Server-owned automatic Area preparation now emits its generated task
  upserts/tombstones through the same guarded feed transaction.
- Existing domain validation, authorization, revision claim and idempotency ledger
  remain the only canonical write path.
- Legacy M5 queue is import-only. Its records are archived before safe removal;
  unsafe structural intents are isolated, not blindly replayed.
- Campaign/Team text and color writes use a 900 ms trailing gate with blur, Enter
  and sheet-close flush. Street/House status remains immediate.
- The runtime suite drives an actual RxDB memory replica against the Worker
  handlers: a controlled Team 503 does not stop a Street pull, and the Street
  appears locally without recreating the database. Actual replication counters
  verify one upstream write for 20 Team characters, 20 Campaign characters and
  6 color changes.
- RxDB 17 rejects `ignoreDuplicate: true` outside dev-mode (`DB9`); the
  production database now keeps the normal duplicate guard instead.
- The previous handoff's statement that a failed-push/independent-pull test was
  unnecessary was unproven; it is now covered by the runtime integration test.
- Same-field Street/House status races and server-deleted update races resolve
  to the canonical D1 document instead of resurrecting or overwriting it.
- Campaign-level Durable Object WebSocket invalidation is implemented with
  Workers Hibernation callbacks, monotonic `changed` hints and internal-only
  post-commit notification. The DO stores no documents or secrets and has no
  idle timer.
- A single `/rxdb/checkpoint` high-water request runs every 45 seconds and
  triggers incremental Pull after a missed signal; disconnect/reconnect and
  duplicate-signal tests prove non-duplicating materialization.
- Global Campaign revision evidence covers a stale Street writer plus two
  clients changing independent Team fields from the same original document;
  canonical D1 converges to both fields with monotonic revisions.
- `npm run audit:dependencies` reports 0 vulnerabilities; the locked RxDB tree
  contains patched `ws` versions.
- Focused RxDB/Worker/SQLite tests and the full 629-test suite pass (629/629).

## Open gates

- Push the branch, create/update its Draft PR against the manual rollback base,
  run CI on the exact pushed feature head and verify the branch preview.
- Configure the CampaignSync Durable Object binding/migration locally; do not
  apply that DO migration or D1 migration 0017 remotely from this branch.
- `npm run typecheck` remains blocked by the sandbox's TypeScript 7 native
  `/proc/self/exe` lookup; no TypeScript diagnostic output is produced.
- Apply migration 0017 only through the approved remote workflow after review.
- Perform two-browser, Android Chromium and iPhone Safari offline/reconnect smokes.
- Do not merge, mark Ready-for-Review, deploy production or apply D1 from code.

## Next step

Push `mission-rxdb-sync` without force, verify the exact GitHub CI head, and
replace the pending feature-head line above if a newer commit is created.

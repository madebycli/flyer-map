# StreetEngine / systemwide D1 read audit

Status: Phase A in progress. Recorded 2026-09-12 UTC.

## Verified baseline

- Repository: `madebycli/flyer-map`, draft PR #92, branch `fix/street-engine-smart-marking`.
- Audited runtime HEAD: `6adaf10aa0f7b1d5a1f885d901164d531d56e633`.
- Latest GitHub staging deployment: run `34660592541`, job `103462087729`, success; checkout is exactly that SHA. Worker version in deployment log: `4cce41c5-c463-41e9-8c04-d4e0c07e9121`.
- CI `34660595993` success. Staging log reports 858 tests passed, zero failures. This is historical CI evidence, not a new local or real-device pass.
- No independent current Cloudflare-version or authenticated device verification yet.
- MapLibre remains exactly 5.7.1, unitbezier 0.0.1. No renderer lifecycle changes planned.
- User reports preparation failure and about 4.5 million D1 rows read. Their common cause is NOT established. No remote database reads, writes, migrations or load tests performed in this audit.
- `MAP_RENDER_P0 = OPEN`; `STREET_ENGINE_LIVE_READY = FALSE`.

## Initial source evidence, not live attribution

`worker/rxdbSync.ts`: bootstrap ignores incremental batch size and loads all matching legacy documents. Street and House bootstrap each call `readPreparedEntities` for the campaign. Incremental SQL is cursor-scoped and limited, but compact feed entries expand to multiple documents. Investigate the consumer's batch-completion contract before changing it.

`src/data/rxdbMissionSync.ts`: visible-client safety checkpoint every 120 seconds, per-collection head comparison, exponential WebSocket reconnect capped at 30 seconds. Replication failures retry every two seconds. This does not prove an idle full-snapshot loop.

`tests/helpers/d1Budget.ts`: existing read estimate explicitly omits some nested/index probes. Its EXPLAIN scan parser only recognizes literal table names, not SQL aliases. Existing budgets are not Cloudflare rows-read measurements.

`worker/areaTaskPreparationApi.ts`: status GET loads canonical Area/state and can schedule pending work. POST rejects geometry payloads, checks authorization and leases, then begins/schedules preparation. `PreparationRunner` executes one phase per alarm under a 50-query invocation cap, with bounded crash recovery. Successful statement counts alone do not prove low rows read.

## Investigation / delivery boundary

Use the [active audit plan](../plans/active/034-street-engine-d1-read-audit.md). Record reproductions and query-cost evidence here as checkpoints. Attribute only measured or reproduced behavior; separate SQLite plans, request counts and Cloudflare billing. Server generation must preserve user-owned labels/status and must not invent Smart Marking intent.

Current live blockers: no sanitized current failed preparation response/job error, no per-query D1 metrics for the reported time window, no two-client convergence trace. Do not claim these are fixed by source inspection.

## Confirmed local reproductions, checkpoint 2

Command: `node --experimental-transform-types --test tests/streetEngineD1Audit.test.ts`. Five tests passed. These are Phase A characterizations of defects, not assertions that those defects are acceptable. Fixtures use an in-memory SQLite database with repository migrations and the installed RxDB implementation. No external requests.

| Scenario | Measured result | Interpretation |
| --- | --- | --- |
| One Team rename, 2,000 unrelated legacy Houses | 36 statements, 6,056 returned rows, 6,006 snapshot rows | `handleRxdbPush` loads the whole campaign before and after `handleCampaignMutation`, which loads it again. Three full House reads for one Team field change. Indexed campaign selection does not remove this amplification. |
| Begin preparation / identical repeat, same fixture | 2,056 / 2,057 returned rows; identical generation | Begin unnecessarily loads the whole campaign both times. Repeat does not create a new generation; duplicate upstream work is a separate lease test. |
| Idle safety checkpoint, same 2,000 Houses | 4 statements, 10 returned rows, zero snapshot rows | Rules out unconditional full-task loading in this helper's healthy idle path. Auth reads and real request rates are not included. |
| Actual RxDB, 101 feed entries changing one Team, batch size 100 | One pull, checkpoint 100, one document, local name Version 100; explicit next pull returns Version 101 | Confirmed early-stop mismatch: SQL limits physical feed entries then deduplicates them. Installed RxDB stops when resulting documents are fewer than batch size. Recovery requires another trigger. This is not permanent server data loss. |
| Aliased `COUNT(*)` full scan over 2,000 Houses | EXPLAIN `SCAN h`, old estimator reports 1 | Estimator counts the aggregate result and misses the alias. Existing read-budget numbers cannot exclude actual scans. |

These demonstrate amplification and a sync defect but do NOT establish the real preparation failure or attribute the reported 4.5m daily reads. An illustrative 750 such renames would return about 4.5m House rows; no evidence says 750 renames actually occurred. Chunk-backed Houses are physical chunk rows, not 2,000 D1 rows, so this legacy-row fixture must not be extrapolated to an unknown live storage layout.

Cloudflare distinguishes scanned rows from returned rows and does not charge per JSON entity or byte size. Actual attribution requires existing D1 metrics/query metadata, not a synthetic estimate. See [D1 billing definitions](https://developers.cloudflare.com/d1/platform/pricing/).

# StreetEngine / systemwide D1 read audit

Status: Phase A, local evidence checkpoint; live attribution blocked on current device/Cloudflare evidence. Recorded 2026-09-12 UTC. No runtime fix or deployment in this investigation.

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

## Additional confirmed evidence

The audit suite now has seven passing characterizations:

- Pending preparation GET before its first alarm: 7 statements, 40 returned rows, one Area snapshot row, no House snapshot, one scheduler call. Auth and DO work are excluded from these helper counts. A status GET is NOT necessarily side-effect-free: it can wake the runner.
- Exact collection-member snapshot SELECT from `campaignRepository.ts`: EXPLAIN reports `SCAN collection_run_members` and `USE TEMP B-TREE FOR ORDER BY`. Existing migration indexes lead on run ID, not campaign ID. This is a concrete systemwide scan outside StreetEngine; its live table cardinality and traffic are unknown.

The existing 47 focused tests also pass locally: `areaPreparationPolling`, `areaTaskPreparationRuntime`, `campaignSyncDurableObject`, `rxdbSyncRuntime`, `streetNetworkIntegration`, `streetNetworkOverpassUpstream`, `streetSyncLifecycleContract`, `streetBudgetRegression`. They cover duplicate fetch suppression, partial-source failure without publication, generation races, persistence rollback, retained manual/user work, two real in-memory RxDB replicas with offline edit/reconnect and bounded mocked source fetches. The 10k fixture completed in 46 alarm invocations, max 45 queries/invocation, 532 estimated writes. These are mocks/local SQLite, not live Overpass, Cloudflare billing or iPad results.

CI for the five-test checkpoint `44c7d3882de1ece097ef84cf40a3b929a621431c`: run `34661770545`, job `103465576168`, success, 863/863 tests, typecheck, dependency audit (explicit historical MapLibre advisory exception), production build. A local typecheck command was started but its result could not be collected after a tool cancellation; no local typecheck pass is claimed. CI independently verifies that checkpoint.

## End-to-end path and failure boundaries

1. `src/map/useNetworkWorkspace.tsx` starts preparation with an empty POST, not client geometry. Its state effect reads permitted Areas at startup and on `scope`, Area ID/update timestamp or `preparing` changes. It is separate from the older sheet poller tested in `areaPreparationPolling.test.ts`.
2. `indexOrganizer.ts -> indexFc52.ts -> indexM55.ts -> index.ts` composes the runtime. Preparation passes access checks, loads one canonical Area, checks schema/fingerprint/current state. `beginAreaTaskPreparation` then unnecessarily loads a complete campaign, as reproduced above.
3. `schedulePreparation` addresses the existing Campaign DO. The runner selects one pending Area using the campaign/status index, verifies fingerprint/generation and lease, executes one phase, rearms recovery. A duplicate POST preserves generation; SQL lease claims protect source execution. There is no evidence for a fresh OSM job per normal status poll.
4. `streetNetwork/preparation.ts`: fixed geographic tiles -> roads -> graph -> buildings -> addresses -> link in 250-building slices -> guarded publish. Source fetch has primary/fallback URLs, finite time/byte/feature limits and at most three transient step attempts. Terminal normalization/partial-payload errors fail the generation. The cache stores public OSM by source/date/grid key, not user intent.
5. `streetNetwork_staging` is generation-scoped scratch. Publication reconciles against an Area-scoped canonical snapshot and atomically writes immutable base chunks, overlays, manifest, preparation state and compact feed under lease/revision guards. Until publish, no partial generation is canonical. `ready` with zero created entities must be distinguished from transport/normalization failure.
6. D1 feed inserts update `campaign_sync_heads`; DO invalidation selects changed collections. Pull expands base/feed into documents; RxDB persists and materializes a generation-filtered snapshot. MapLibre consumes that canonical geometry. A successful DB publish does not prove either client convergence or visible geometry.
7. The public failure mapping in `runAreaTaskPreparation` maps otherwise unclassified failures to `area_preparation_osm_failed`. The detailed cause is held in `street_network_jobs.error_code` and `metrics_json.lastError` (phase/cursor/code/attempt). Thus the public code cannot distinguish source transport, malformed data and some internal processing errors. No current row/log for Master's failed job is available in this audit.

## Systemwide read inventory

Symbols: L = matching legacy task rows, B = base/overlay chunk rows, A = Areas, E = matching logical history events, M = all collection-member rows, N = active clients. These are scaling descriptions, not billed totals. Outer authentication/schema probes must be added to each helper cost.

| Trigger / path | Query scope and index | Read scaling / frequency / finding |
| --- | --- | --- |
| Normal startup, `campaignStore.startRxdb` / `rxdbSync.bootstrapDocuments` | Campaign/team/area ID or campaign indexes; task joins to Areas; correlated network/position lookup by primary key | All matching L returned without a bootstrap page limit. Street and House pulls each read both kinds of prepared chunks before filtering; extra legacy Street read for manual House parents. O(L+B) per bootstrap, not every render. Scope filters precede legacy reads but prepared group filtering follows campaign-wide chunk reads. |
| Manual snapshot and Collection startup/refresh, `index.ts`, `indexM55.ts`, `campaignRepository.ts` | Campaign-indexed teams/areas/tasks/houses; prepared chunks; collection relations | Full campaign read. Collection response discards distribution entities only AFTER loading them. `collection_run_members WHERE campaign_id=? ORDER BY joined_at,id` scans all M, confirmed by EXPLAIN. Collection client reloads on explicit refresh/mutation; no periodic timer found in that path. |
| Preparation POST/retry, `areaTaskPreparation.ts` | Full campaign snapshot then point state lookup | One avoidable O(L+B) read per accepted begin attempt even for one Area. Identical repeated begin retains generation but repeats these reads. |
| Preparation status, `useNetworkWorkspace.tsx`, `areaTaskPreparationApi.ts` | Area by ID/campaign; preparation by composite PK; job by campaign/Area; schema probes | Initial read for every permitted Area. Pending/unknown/error states repeat after 2 seconds plus request duration. Failed/ready/missing successful responses stop repeating until effect restart. Non-OK responses do not enter `known`, so even permanent 401/403/503 can retry indefinitely. No hidden-tab check or error backoff in this effect. Dependency changes clear all known states; starting and finishing a POST each resets it. Source evidence; live frequency not yet measured. |
| DO alarm, `streetNetwork/runner.ts` | `(campaign_id,status)` pending selection; primary-key job/state reads; scoped staging | One bounded phase/lease, max 50 statements, not a rows-read cap. Ready/failure ends normal pending progression; crash failure counter stops after six unsuccessful runner attempts. Each link slice rereads staged edges, O(edge chunks × ceil(buildings/250)); publish is Area-scoped for entities. |
| OSM source cache, `sourceCache.ts` | `(cache_key,part)` lookup; pruning selects metadata ordered by cached_at and deletes outside 32 keys | Cache hit avoids source fetch. Prune can scan/sort cache parts, but successful pruning limits retained tile keys to 32. Across many Areas/dates cache churn can repeat source acquisition. No live churn rate known. |
| Incremental pull, `rxdbSync.ts` | `(campaign_id,collection_name,seq)` or `(campaign_id,scope_team_id,collection_name,seq)` range and LIMIT | At most requested physical feed rows, NOT requested expanded documents. Dedupe creates premature short-page stop (reproduced). Every pull also reads generation manifests and revision. Bootstrap and compact expansion lack a consistent document bound. |
| Healthy visible idle/reconnect, `rxdbMissionSync.ts` | `campaign_sync_heads` composite PK prefix; campaign revision PK | Safety checkpoint every 120s, then only changed collections; local helper 4 queries/10 returned rows with empty heads. 720 checkpoints/client/day if continuously visible. WebSocket reconnect backs off 2s to 30s; network/auth calls are not zero. No evidence of unconditional repeated full snapshots. |
| Pull outage, `createReplication` | Same schema/auth/feed or bootstrap paths | RxDB retryTime 2s, up to five collections. Persistent failures amplify reads; cold clients repeat bootstrap until success. `toggleOnDocumentVisible` helps the replication layer, not the separate preparation polling effect. |
| User Team/Area/Street push, `rxdbSync.handleRxdbPush`, `mutationHandler.ts` | Full campaign snapshot before mutation, inside mutation, after mutation | Confirmed 3×L for one Team rename. House-target writes scope House reads but still read campaign Streets. `campaignExecution` splits batches into one-row DO calls to preserve invocation budget; this does not reduce total reads. Client batch size 20, server accepts up to 40. |
| Network intent queue, `networkIntentQueue.ts` | Local IndexedDB every 5s; remote intent/replay key `(campaign_id,intent_id)` | Empty queue produces no remote call. Queued transient failures retry; one flushing promise per scope prevents in-tab overlap. `streetNetwork/api.ts` reads Area snapshot BEFORE checking replay, so replay is write-idempotent but not read-free. User route/status selection is required. |
| Organizer/login/access, `organizationApi.ts`, `organizationAuth.ts`, `organizationCampaignAccess.ts` | Session hash UNIQUE/index; accounts/campaigns PK; memberships indexed by account; campaign list indexed by organization | Point/indexed joins per authenticated request. Organization campaign/member lists are unpaginated. No periodic full-campaign poll found in Organizer. Real auth traffic, invalid-session retries and account-wide usage remain unknown. |
| Statistics/progress, `statistics.ts`, `StatisticsHub.tsx` | Scoped task aggregates; history relation; all-campaign canonical snapshot at end | Initial aggregates then another full snapshot to compute primary progress, including for narrower team summaries. O(L+B+E) plus joins/sorts, triggered by opening/filter/reconnect/manual reload, not a 2s timer. Potential duplicated work and cross-scope read cost, not evidence this view caused the live spike. |
| Activity/history/session tasks, `activity.ts`, `fieldSessionTasks.ts`, `domainEventHistory.ts` | Legacy event campaign/time and session/time indexes; history batch PK campaign prefix / session index; `json_each` expansion | Response LIMIT or DISTINCT does not bound all logical events inspected/sorted. Compact history improves writes but can expand E on reads. Batch table has no campaign+time ordering index. Read tradeoff must be measured, not inferred from returned event count. |
| Comments summary, `teamCommentsSummary.ts` | Campaign/team comment indexes and keyed entity joins; ORDER BY joined Area label, LIMIT 300 | Sorting can examine more than 300 comments. Open/scope/explicit refresh driven. Joins address legacy task rows; chunk-only entity labels need a separate correctness check, not a speculative read-cost attribution. |
| Rooms/groups/sessions, `fieldGroups.ts`, `organizationFieldGroupList.ts` | Campaign/team/state group indexes; correlated credential and member counts by group indexes | Cost grows with groups and active member rows, not just returned group count. Some group list/read handlers expire stale groups and therefore may write; do not invoke remotely under an assumption that GET means read-only. |
| Pickup/collection search, `pickupRepository.ts`, `pickupSearch.ts` | Campaign pickup index, no paging in full pickup load; main Area point/campaign lookup | All campaign pickups, including records later filtered by visibility, read on snapshot. Search UI debounce and bounded upstream fetch are separate from D1 list loading. No evidence for an autonomous Street-related query loop here. |

## Attribution and differential baseline

| Scenario | What is established | What is not established |
| --- | --- | --- |
| Healthy idle, no preparation | Small indexed safety helper, local empty network queue; startup probes Areas | Full outer-request rows and actual per-client calls |
| One preparation | Local pipeline publishes 10k Houses atomically; start reads full campaign; alarm is phase-bounded | Current real source response, phase failure, latency, billing |
| Repeated preparation | Same generation; existing tests block duplicate concurrent upstream fetch; each begin rereads snapshot | Number of real clicks/retries and whether leases expired during the reported failure |
| Reconnect | Existing two-replica offline test converges; incremental short-page defect independently reproduced | Real device storage loss, auth failure, repeated cold bootstrap, timing of invalidations |
| Multiple clients | N clients multiply independent polls/retries; leader election can reduce same-database tabs, not separate devices | Actual N and lifetime of tabs |
| Non-Street activity | Team push 3× legacy read; collection-member full scan; stats full snapshot | Whether any of these operations were active during the 91% usage window |

**Real D1 attribution remains unknown for every category.** No percentages are assigned. Source-level rates provide bounds: for A pending/error Areas and N active clients, a near-instant two-second poll loop approaches `43,200 × A × N` status calls/day. Four Areas and one client approach 172,800 calls/day; 40 returned helper rows each would total about 6.9m returned rows, but this is NOT billed rows, excludes timing/auth, and successful terminal states stop polling. With a 10s timeout the cycle is slower. This explains why status traffic is worth measuring; it does not prove this scenario happened.

## Prioritized fix / verification plan (not yet implemented)

1. Obtain the existing failed job's sanitized internal error and current D1 metrics/time window. Match version, database, campaign/Area and event time. If the daily quota is nearly exhausted, avoid another preparation or remote scan merely for diagnosis.
2. Stop demonstrated/request-rate amplification: separate persistent preparation state from React effect restarts; stop permanent authorization failures; exponential bounded error retry; hidden/offline pause; use progress notifications with sparse fallback. Never restart a server generation to fetch status. Test the actual workspace poller, not only the older sheet helper.
3. Remove unrelated snapshot reads from preparation begin and narrow each mutation's read set. Keep the existing canonical domain validation, revision guards, dependent-entity operations, scope and conflict semantics. Do not persist a partial snapshot as if it were the full campaign. Repeat 0/2k/10k legacy and chunk-backed fixtures for single-field changes and no-op/replay writes.
4. Repair the replication contract. Physical feed paging, dedupe, expanded documents and empty/scoped pages need an explicit continuation strategy that RxDB consumes correctly. Bound bytes/documents without skipping the tail of a compact row; preserve deletion/scope order and checkpoints across restart. Avoid an unbounded server loop simply collecting 100 distinct IDs. Test 101 same-ID changes, huge compact row, interleaved collections, empty scope pages, concurrent publish and offline edits with actual RxDB.
5. Fix Collection-only snapshots so they do not load distribution geometry, and propose a local migration for the missing campaign-leading member index after EXPLAIN/write-cost review. No remote migration is authorized. Analyze history/statistics limits and JSON expansion against measured traffic before redesigning them.
6. Fix the exact observed preparation failure using its phase/error/source evidence. Test original payload or a sanitized minimal equivalent, timeout/rate-limit/partial response, resume, generation races and persistence. Retain bounded acquisition, chunk publication and user-owned overlays.
7. Improve read instrumentation: alias-aware scan diagnostics, mark nested/index/JSON probes as unmeasured, retain query fingerprints/route labels with no bindings, correlate existing `meta.rows_read`/Cloudflare analytics. Do not claim a universal row estimate from returned rows.
8. Run complete tests/typecheck/audit/build, verify exact PR head and staging-only workflow, deploy only after relevant fixes are complete and CI green. Real-device prepare/persist/two-client/map and measured idle/preparation/reconnect windows are required for closure.

## Concrete evidence needed from Master

- From existing F12 Network entries: preparation POST status and JSON, then the last preparation GET status/JSON, timestamp and duration. Include `errorCode`, phase/cursor/progress if present; do not share Cookie, Authorization, tokens or an unredacted HAR.
- Current `/api/runtime` JSON (non-sensitive build/deployment metadata), or its existing Network response, to independently tie the device to the deployed version.
- Cloudflare D1 dashboard for the relevant time window and database: rows-read curve and the most expensive available query statistics with query count/rows read. Existing metrics only, no `COUNT(*)` over live tables. Determine whether 91% refers to this database or account-wide usage.
- If the public error remains generic, obtain one job's `phase`, `cursor`, `attempts`, `error_code`, `lease_until`, and `metrics_json.lastError` using an explicitly selected, indexed campaign+Area lookup. No credentials or raw geometry needed. This audit did not run such a remote query.

No Phase B runtime change, workflow modification, staging deployment, production change or remote D1 operation has been performed. Phase A cannot honestly be marked complete until the real failure and consumption window are attributed. Smart Marking remains user-directed; preparation only creates/reconciles the base and preserves work state.

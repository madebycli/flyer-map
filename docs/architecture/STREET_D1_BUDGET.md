# Street D1 budget audit

Local audit, 2026-09-09. Production and remote D1 were not queried or changed.
Baseline: PR #84 head `f4facd6ef354c5ba6de861519b696bce6f46a209`.
Recovery checkpoint: `fce8c58713c1f8c0b20e4a5544040accb8042370`.

## Method and limits

`tests/helpers/d1Budget.ts` executes actual SQLite with foreign keys. TEMP triggers
count committed table INSERT/UPDATE/DELETE rows and cascades. Index writes are
estimates, one per affected index. Read estimates combine returned rows and
recognized full-scan cardinalities; they do not count every indexed probe or
JSON traversal. Timings include audit instrumentation and synthetic in-memory
OSM responses. These are regression metrics, not live latency or Cloudflare billing.
The first house-update fixture was below the geometry validator's minimum area;
measurements below use accepted geometry and require no push rejections.

Run `node --experimental-transform-types scripts/street-d1-budget.ts` locally.
Set `STREET_ENGINE_MODULE_ROOT` to the original checkout for a comparable baseline.
Never run these 5k/10k fixtures remotely.

## Measurements before the storage pivot

| Variant | Action | Houses | Queries | Max batch | Table writes | Index estimate | Total estimate | Read estimate |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Original | preparation | 400 | 88 | 7 | 1281 | 4149 | 5430 | 235 |
| Original | house-status | 400 | 50 | 4 | 4 | 5 | 9 | 1520 |
| Original | smart-mark | 400 | 24 | 7 | 65 | 64 | 129 | 487 |
| Original | delete | 400 | 467 | 424 | 1271 | 4156 | 5427 | 1087 |
| Original | preparation | 1000 | 108 | 11 | 3087 | 10151 | 13238 | 245 |
| Original | house-status | 1000 | 50 | 4 | 4 | 5 | 9 | 3320 |
| Original | smart-mark | 1000 | 24 | 7 | 155 | 154 | 309 | 1087 |
| Original | delete | 1000 | 1067 | 1024 | 3073 | 10158 | 13231 | 2287 |
| Original | preparation | 5000 | 262 | 35 | 15137 | 50169 | 65306 | 365 |
| Original | house-status | 5000 | 50 | 4 | 4 | 5 | 9 | 15320 |
| Original | smart-mark | 5000 | 24 | 7 | 755 | 754 | 1509 | 5087 |
| Original | delete | 5000 | 5067 | 5024 | 15091 | 50176 | 65267 | 10287 |
| Original | preparation | 10000 | 453 | 63 | 30200 | 100192 | 130392 | 625 |
| Original | house-status | 10000 | 50 | 4 | 4 | 5 | 9 | 30320 |
| Original | smart-mark | 10000 | 25 | 8 | 1505 | 1504 | 3009 | 10087 |
| Original | delete | 10000 | 10067 | 10024 | 30114 | 100199 | 130313 | 20287 |
| Recovery | preparation | 400 | 96 | 7 | 1284 | 4150 | 5434 | 238 |
| Recovery | house-status | 400 | 50 | 4 | 4 | 5 | 9 | 1520 |
| Recovery | smart-mark | 400 | 24 | 7 | 65 | 64 | 129 | 487 |
| Recovery | delete | 400 | 467 | 424 | 1272 | 4157 | 5429 | 1087 |
| Recovery | preparation | 1000 | 116 | 11 | 3090 | 10152 | 13242 | 248 |
| Recovery | house-status | 1000 | 50 | 4 | 4 | 5 | 9 | 3320 |
| Recovery | smart-mark | 1000 | 24 | 7 | 155 | 154 | 309 | 1087 |
| Recovery | delete | 1000 | 1067 | 1024 | 3074 | 10159 | 13233 | 2287 |
| Recovery | preparation | 5000 | 274 | 35 | 15144 | 50174 | 65318 | 410 |
| Recovery | house-status | 5000 | 50 | 4 | 4 | 5 | 9 | 15320 |
| Recovery | smart-mark | 5000 | 24 | 7 | 755 | 754 | 1509 | 5087 |
| Recovery | delete | 5000 | 5067 | 5024 | 15096 | 50181 | 65277 | 10287 |
| Recovery | preparation | 10000 | 469 | 63 | 30211 | 100201 | 130412 | 753 |
| Recovery | house-status | 10000 | 50 | 4 | 4 | 5 | 9 | 30320 |
| Recovery | smart-mark | 10000 | 25 | 8 | 1505 | 1504 | 3009 | 10087 |
| Recovery | delete | 10000 | 10067 | 10024 | 30123 | 100208 | 130331 | 20287 |

## Root cause

Preparation persists each prepared House three times: canonical `house_tasks`,
`house_road_positions`, and `campaign_sync_changes`. Primary, Campaign, Area,
parent and feed indexes amplify those writes. Job metrics are additional work,
but are not the dominant 10k cost. Recovery alone does not solve this.

Delete cascades through canonical entities and position/network tables, then emits
one feed statement per entity. The 10k delete batch exceeds 10,000 statements.
`batch()` does not convert those into one billable query. The original 10k
preparation publish also exceeds the Free per-invocation 50-query limit.

A House status update is cheap in writes but the current mutation route reads and
validates the whole Campaign repeatedly. The local valid request already reaches
50 SQL statements before any outer request authentication. A batch-size check alone
cannot prove that a complete Worker invocation fits the Free limit.

## Ground truth and remote attribution

Cloudflare documents 5 million rows read/day and 100,000 rows written/day on Free,
account-wide, plus 50 queries per Worker invocation. Reads count rows scanned,
not only rows returned, and indexes can add writes. See
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

Local SQLite runs do not consume remote D1 quota. Existing persistent staging,
isolated staging, migrations, live interactions and read-only diagnostic SELECTs
do. GitHub run success does not reveal account-wide D1 usage. An older diagnostic
artifact download was unavailable (HTTP 403); no new diagnostic run was triggered.
Attribution of Master's warning to one particular run remains unproven.

The three Street-related remote workflows now require manual dispatch; normal CI
still runs locally in Actions. Exact-branch/head and staging-identity checks remain.
This prevents repeated WIP pushes from automatically consuming the remote budget.
One selected small staging candidate can later record actual `meta.rows_read` and
`meta.rows_written`, including authentication, setup and cleanup. No large remote
fixture is necessary. Post-pivot measured values and a complete invocation budget
must be added before claiming the cost target is met.

## V6 candidate checkpoint, full migration schema

Local SQLite fixtures, including history and collection migrations. Synthetic OSM,
not live Overpass, Cloudflare CPU or billing evidence. Timings may include local
CPU contention and are not browser/end-to-end acceptance. Reads below are the
adapter estimate, not actual rows scanned by every index/JSON operation.

| Action | Houses | Queries across all calls | Estimated reads | Logical writes | Index estimate | Total write estimate | Local ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| preparation | 400 | 108 | 198 | 62 | 77 | 139 | 1173 |
| house-status | 400 | 39 | 123 | 6 | 10 | 16 | 38 |
| smart-mark | 400 | 23 | 101 | 38 | 120 | 158 | 63 |
| delete | 400 | 34 | 132 | 52 | 84 | 136 | 428 |
| preparation | 1000 | 124 | 208 | 72 | 83 | 155 | 1698 |
| house-status | 1000 | 39 | 123 | 6 | 10 | 16 | 10 |
| smart-mark | 1000 | 23 | 101 | 72 | 274 | 346 | 38 |
| delete | 1000 | 34 | 140 | 58 | 90 | 148 | 29 |
| preparation | 5000 | 266 | 300 | 164 | 152 | 316 | 6097 |
| house-status | 5000 | 39 | 123 | 6 | 10 | 16 | 13 |
| smart-mark | 5000 | 23 | 110 | 273 | 1275 | 1548 | 164 |
| delete | 5000 | 34 | 160 | 90 | 131 | 221 | 93 |
| preparation | 10000 | 444 | 413 | 284 | 248 | 532 | 5177 |
| house-status | 10000 | 39 | 126 | 6 | 10 | 16 | 28 |
| smart-mark | 10000 | 23 | 126 | 525 | 2527 | 3052 | 198 |
| delete | 10000 | 34 | 192 | 133 | 190 | 323 | 89 |

The complete DO alarm test uses all migrations: 46 invocations, maximum 48 D1
queries per invocation, 532 estimated preparation writes. History-enabled marking
of 500 Houses uses 24 queries and 3,053 estimated writes including 501 history
events. These events retain per-entity audit semantics; history amplification is
still material and must not be hidden behind the history-disabled result.

The prior 49-query result used a reduced schema and is superseded by this test.
A full-schema failure was reproduced and fixed by excluding unrelated Collection
snapshot reads. House mutations additionally select the matching House partition
and Street reference chunks. Schema introspection is cached only per invocation.

MapLibre's 10k regression verifies one property diff below 200 bytes for one House
status update, no geometry retransmission, and one removeAll on deletion. This is
an API-level renderer test, not a real-device frame-time measurement.

Remaining gates: exact indexed read/CPU metadata, authenticated live failure and
Overpass timing, empty-campaign browser timings, atomic cross-collection generation
rendering, migration/manual-parent compatibility, stale generation races and old
staging cleanup. No Production action or remote load test has run.

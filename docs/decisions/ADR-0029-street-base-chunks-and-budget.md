# ADR-0029: Street base chunks and D1 budget

Status: accepted design for the recovery candidate, implementation in progress.
Date: 2026-09-09.
Supersedes the per-entity prepared-base persistence in ADR-0027 and the
invalidation-only restriction of ADR-0025 solely for the persistent preparation
alarm on the existing Campaign Durable Object. Authorization and D1 authority remain.

## Evidence

See [local D1 audit](../architecture/STREET_D1_BUDGET.md). Preparing 10k Houses
costs about 130k estimated table-plus-index writes before any user work. Deletion
repeats comparable amplification and exceeds the per-invocation query budget.
Already invested development work was deliberately not counted as an advantage
of the existing architecture.

## Candidates

| Model | Speed / reliability | Cost | Offline / sync | Operations |
|---|---|---|---|---|
| A: canonical row per prepared entity plus metadata and feed | Simple entity lookup; remote OSM latency unchanged | 10k preparation exceeds estimated daily Free writes; rejected | Existing RxDB entity replication | Low setup, unacceptable write amplification |
| B: regional immutable PMTiles/static base plus D1 overlay | Best warm path; no public OSM dependency for covered regions | Static assets possible; R2 free allocation is limited and excess is billable | Versioned manifests and local base cache required | Needs maintained regional extract, coverage, build and updates |
| C: immutable chunks in D1 plus compact mutable overlays | Few database rows; remote OSM still affects a cold uncached Area | Existing D1 only; enforce chunk and invocation budgets | Expand compact feed chunks into existing local entities; preserve offline writes | Additive migration and guarded atomic generation publication |

Choose C now, with source acquisition isolated so a supplied regional B dataset
can replace cold Overpass later. Do not claim live Overpass has left the hot path
until a real regional artifact and update policy exist. No paid API or new managed
service is introduced. No unbounded retries or whole-Campaign rewrite on geometry edits.

## Storage and consistency contract

Prepared OSM geometry belongs in immutable bounded JSON chunks. User-owned labels,
status and coverage belong in separate compact overlays. Stable identities survive
generation changes. Reconciliation compares content and writes changed chunks;
manual entities remain in their established tables. One guarded transaction publishes
the complete generation and compact feed changes. Old generation remains usable
until publication; deleted Areas hide all cached children immediately.

The server may expand chunk feed entries into the existing entity replication
protocol. This transfers bytes without persisting one feed row per House. Explicit
House changes and range marking must not rematerialize a complete prepared base.
No bare SQL-statement count is accepted as a substitute for rows-written budgets.
A migration is additive and local until a selected staging acceptance is authorized
by the existing task. Production migration/deployment remains excluded.

Existing DO alarms continue durable jobs without a browser. D1 holds phase boundaries,
lease and generation. Progress should use the existing authenticated invalidation
channel and a sparse fallback; a two-second D1 polling loop is not the target.

## Established tools evaluated

| Tool | Relevant capability | Decision / license boundary |
|---|---|---|
| [Planetiler](https://github.com/onthegomap/planetiler) | Parallel regional PBF to custom vector tiles/PMTiles | Preferred future regional build tool; Apache-2.0, Java runtime and extract maintenance required |
| [PMTiles](https://docs.protomaps.com/pmtiles/) | Immutable archive, HTTP Range reads | Future base delivery format; not an address extractor or sync engine |
| [Osmium Tool](https://osmcode.org/osmium-tool/) | PBF filtering and regional extraction | Suitable standalone build tool, GPLv3; no code copied into app |
| [osm2pgsql](https://osm2pgsql.org/doc/manual.html) | OSM import and updates in PostGIS | Not selected: requires an additional maintained database |
| [OpenMapTiles](https://openmaptiles.org/schema/) | Building and housenumber display layers | Reference only: rendering geometry does not prove complete deliverable address identity; schema CC-BY and implementation BSD |
| [GraphHopper](https://github.com/graphhopper/graphhopper) | Routing and snapping | Apache-2.0; does not solve address completeness or D1 replication |
| [Valhalla](https://valhalla.github.io/valhalla/) | Tiled routing engine | MIT; additional routing service not justified for this storage problem |
| [StreetComplete](https://streetcomplete.app/) | Offline field-work UX | Interaction reference only, no copied source |
| [Every Door](https://every-door.app/) | Address and POI field editing UX | Interaction reference only, no copied source |

R2 is not assumed permanently free: its
[pricing](https://developers.cloudflare.com/r2/pricing/) has storage and operation
allowances. Source OSM attribution remains required independently of tool licenses.
No new runtime OSS dependency is selected by this ADR.

## Rollout and rollback

Keep the checkpoint commit and original branch. Retain legacy manual entity tables
and reject unsupported schema activation visibly. Verify generation races, offline
reconnect, scope changes, user edits, 10k local preparation/deletion and complete
request query budgets before enabling the candidate. Do not roll an older reader
onto a database containing chunk-only Areas without restoring a compatible reader
or explicitly exporting those Areas. New storage is not proven complete by this ADR.

# D1 gate, frozen source b126e708, 2026-09-12

D1_STATUS = OPEN (narrow StreetEngine link-phase follow-up only).
AREA_DELETE_READ_PATH = VERIFIED_FIXED (local code/regression scope).
D1_ATTRIBUTION_CONFIRMED = FALSE.

The exact prepared-Area delete amplification fixed by 8b1bec21 is independently reproduced as fixed through handleRxdbPush -> handleCampaignMutation -> mutationSnapshotOptions. street_base_areas is probed by campaign/Area key BEFORE snapshot loading. Prepared deletion skips child snapshots and emits the compact Area tombstone. Legacy deletion uses areaId to load only its own children for required tombstones; it no longer needs an unrelated Campaign child snapshot. The outer Area RxDB snapshots also exclude children.

Local baseline suite: 38/38 PASS, including streetEngineD1Audit, streetBudgetRegression, streetBaseStorage, streetGenerationRace, streetEngineRecovery, streetNetworkOverpassUpstream and streetSyncLifecycleContract. Prepared deletion fixture: 2,000 legacy child rows plus a prepared manifest, 21 statements, 55 returned rows, five snapshot rows. Full 10k chunk/DO lifecycle: 46 alarms, at most 45 statements/alarm, 532 estimated preparation writes; deletion 22 statements, 323 estimated writes and one feed row. Independent RxDB clients and stale offline child rejection pass at protocol level. These are NOT Cloudflare billing or browser/device measurements.

CI for frozen HEAD b126e70899ad5a5c206d8c3ed0fa1fe7b34766fe: run 34716462762, job 103614482861, Test/Typecheck/Dependency audit/Production build all success. Existing audit exception for pinned MapLibre remains; green audit does not mean zero advisories.

No new delete rewrite is justified. Broad systemwide D1 investigation stops here. The gate cannot be globally VERIFIED_FIXED because one directly affected StreetEngine path remains reproduced: runNetworkPreparationStep(link) loads all staged edges for every 250-House slice. Synthetic 10k/20-road fixture reads the edge payload 41 times (40 link slices plus publish), 527,629 bytes. Table street_network_staging has an appropriate campaign/Area/generation/kind prefix; an index alone cannot reduce deliberately requested full payloads. Trigger: each link slice; fan-out ceil(addressableBuildings/250); retry/crash re-execution adds reads. Benefit target: bounded generation-scoped graph reuse or spatial partitions, with cold-restart fallback, measured edge bytes and rows, no second source of truth. Test candidate: scripts/street-masterplan-audit.ts plus cold-runner restart and generation race gates.

Other observed limits stay in the StreetEngine plan: readPreparedEntities expands both kinds on bootstrap; publish materializes the complete selected Area; source-cache eviction scans cached entries. Do not open unrelated auth/statistics/index projects without a new reproduction. The reported 4.5M rows require matching database, time window and real meta.rows_read/analytics. No remote D1 query was run.

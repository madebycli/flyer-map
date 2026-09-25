---
id: status-current
type: status
status: active
last_updated: 2026-09-25
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`. The release-channel invariant there maps `beta` to the Beta Worker and Beta D1; `main` is Stable.

- PR #127 is on Beta as commit `0266375b254834a354a525260266fbb62c6fe250`. The 2026-09-25 real Gebiet-8 retry selected the current 130-shard pack, loaded all shards, and calculated 55,270 Streets and 46,665 Houses. After ~944 seconds active work, it failed at the first `v4-base` bucket with the generic `street_engine_v4_publish_internal_failure`; no generation was published. The precise exception is unknown. The next Beta-only slice raises the feed's 75 KB per-entity limit to the 220 KB base limit, verifies a Street above 75 KB under a 50-query alarm, and records the base substep plus a specific row-budget code on failure. Device retry remains required; `STREET_ENGINE_LIVE_READY=FALSE`.

- PR #126 repaired the 50-query Free D1 alarm budget; PR #127 repaired same-generation retries that retained an outdated source manifest. Gebiet 7 was previously accepted with 788 Streets and 1,737 Houses. A local rectangular Gebiet-8 BBox replay reached `ready` under the 50-query wrapper, but local SQLite does not establish the exact private Area or Cloudflare D1 limits.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.

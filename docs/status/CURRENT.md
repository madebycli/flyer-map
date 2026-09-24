---
id: status-current
type: status
status: active
last_updated: 2026-09-24
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`. The release-channel invariant there maps `beta` to the Beta Worker and Beta D1; `main` is Stable.

- Beta Release `35990464951` deployed PR #125 at `4b18ec18a2563b37549852616ec2dc04bed07526`, V4 only with no legacy Overpass runtime fallback. Gebiet 7 had previously been accepted with 788 Streets and 1,737 Houses.
- The first real Gebiet-8 attempt on this release failed at 11:39 UTC with `area_preparation_runner_unavailable`: the V4 job remained at source cursor 0, 130 shards selected, zero shard bytes, zero job attempts and an expired lease. The runner exhausted its alarm crash guard, not an ordinary source retry. Gebiet 8 remains **not ready**.
- The Free D1 budget is 50 statements per alarm. A local 130-shard replay through that exact wrapper reproduced `d1_invocation_budget_exceeded` on the first source shard, with no persisted attempt. Per-bucket DELETE+INSERT exceeded the limit; later graph steps had a second query amplification from 32 separate node-usage reads. The current Beta-only fix batches group rows through bounded `json_each` statements and reads node usage eight buckets per query.
- With the same 50-statement wrapper on every step, the **prior** real Beta pack (`abee0c7125228ecf603c16de1ec7788937ac6dd6c6e16001a7040e34a6200ab0`) reached `ready` in 762 local alarm steps over the Gebiet-8 rectangular BBox superset: 62,179 Streets / 52,276 Houses, zero attempts and zero legacy Overpass. The currently deployed new pack and exact private Area have not been replayed this way, and local SQLite does not establish remote D1 latency or Cloudflare isolate limits.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.

---
id: status-current
type: status
status: active
last_updated: 2026-09-24
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`. The release-channel invariant there maps `beta` to the Beta Worker and Beta D1; `main` is Stable.

- Live Beta remains `1937868f5e0ee7522134da1850262dacc97ce124` (Release #38), V4 only, with no legacy Overpass runtime fallback.
- Gebiet 7 was accepted on Beta with 788 Streets and 1,737 Houses. Gebiet 8 remains **not ready**. A real-device run on 2026-09-24 loaded 130 shards and failed at `street_engine_v4_graph_build_budget`; a subsequent retry failed during source selection with the generic `street_engine_v4_source_unavailable`, two object gets and zero selected shards. The latter code does not establish that source assets are missing.
- Draft PR #125 on `fix/beta-v4-staged-preparation-2026-09-19` stages V4 preparation across Durable Object alarms and D1 generation rows. It is not merged or released. Follow-up head `9c5e743b22eb358b179bbc7d3ce152f2f5a8eea4` passed CI (including tests, Typecheck, dependency audit and production build) and the independent synthetic audit. A further local fix preserves global address-key deduplication and partitions House linking spatially; it still needs final-head CI.
- Read-only replay of the live Beta Pack (`abee0c7125228ecf603c16de1ec7788937ac6dd6c6e16001a7040e34a6200ab0`) selected the same 130 shards / 8,378,842 compressed / 57,609,521 decoded bytes as the device. A **rectangular BBox approximation** of Gebiet 8 reached `ready` with 62,179 Streets and 52,276 Houses, `legacyOverpassRequests=0`, 64,650 globally deduplicated source addresses, 118.7 MiB sampled peak V8 heap under `--max-old-space-size=128`, 12 maximum D1 batch statements, and 177 s elapsed locally. The 1,158.6 MiB local RSS includes the in-process SQLite test D1 and is not a Cloudflare isolate measurement. The exact private Area polygon and real Worker/D1 execution still need field validation.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.

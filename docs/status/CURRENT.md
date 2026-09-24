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
- Draft PR #125 on `fix/beta-v4-staged-preparation-2026-09-19` stages V4 preparation across Durable Object alarms and D1 generation rows. It is not merged or released. Its original head `3506c51dc702dbb37124a8599de4351990228000` passed independent Scale Audit but failed five recovery tests. The local follow-up fixes these tests and pins generated task timestamps; final-head CI and a real-pack 128 MiB replay are still required.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.

---
id: status-current
type: status
status: active
last_updated: 2026-10-08
---

# Current Project State

The authoritative cross-repository route is `.ai/CONTEXT.md` → `madebycli/master-context/projects/flyer-map/INDEX.md` → `handoffs/CURRENT.md`. The release-channel invariant there maps `beta` to the Beta Worker and Beta D1; `main` is Stable.

- 2026-10-08: a parallel **v5 field core** exists on `claude/v5-field-core` (page `/v5`, endpoints `/api/v5/*`, unapplied migration 0026). It derives Streets/Houses on the client from a per-Area OSM pack and syncs only a status overlay, avoiding the V4 pipeline that fails for Gebiet 8. Verified by tests and a Playwright flow against the real handlers on in-memory D1; **not** verified on real devices, real Overpass data or a real D1. Since then v5 gained marking tools (≤ 60 m street chunks), an Area corner editor, visible two-writer conflicts, field notes (migration 0027, also unapplied), the Abholaktion surface on the legacy collection backend (Gebietsliste, Übernehmen/Teilnehmen, Room, Sonder-Marker; server-checked collector scoping), and a Rust/WASM engine (`engine-rs`) that keeps the geometry and serves MapLibre vector tiles (TypeScript engine + GeoJSON stay as the fallback). 1149 unit tests and eight browser flows (all also in fallback mode) pass; real devices, real Overpass data and a real D1 are still missing. Routing runs in Rust too (exact against the TypeScript reference). Aktions-Vorlagen (the whole map with its Gruppen as one file, plan before applying, automatic clean-up with a confirmation guard), search and lasso in Rust too, location preselection and role-aware Menü are in ([Plan 045](../plans/active/045-v5-pickup-rooms-admin.md) C done). UI v2 ([Plan 047](../plans/active/047-v5-field-ui-v2.md)): calm square design, one marking button with morphing panels, Home menu, overview by houses, search, configurable basemap, admin prune. See [Plan 043](../plans/active/043-v5-field-core.md), [Plan 045](../plans/active/045-v5-pickup-rooms-admin.md), [Plan 046](../plans/active/046-v5-rust-tiles.md), [ADR-0034](../decisions/ADR-0034-v5-notes-chunks-and-engine-language.md). `STREET_ENGINE_LIVE_READY=FALSE`.

- The 2026-09-25 11:28 UTC Gebiet-8 diagnosis identifies exact PR-#128 Beta Worker `e1f2fb85-a9a0-4b10-a1e4-3d3de43534b2`, the same 55,270 Streets / 46,665 Houses, and another generic failure at `v4-base` cursor 0. It was copied 514 ms after a same-generation retry began: outer preparation `pending` at 11:28:26 while the V4 job still showed the previous failed phase. The reason `baseStep` was absent is proven: `diagnostics.ts` omitted it from its public allowlist even though the job stored it on failure. The Beta-only diagnostic fix allowlists bounded `baseStep` and `baseFailureClass`; a regression verifies both through the public snapshot. The specific D1 exception and the outcome of the newly begun retry remain unknown. `STREET_ENGINE_LIVE_READY=FALSE`.

- PR #128 is on Beta as commit `c20a6ce748ef73efbfd31fbaf554801a48043b9a`. The earlier real Gebiet-8 retry loaded the 130-shard pack and calculated 55,270 Streets / 46,665 Houses before failing at the first Base bucket. PR #128 aligned the feed and base row limits to 220 KB, but the fresh device run still failed at that bucket. No generation has been published.

- PR #126 repaired the 50-query Free D1 alarm budget; PR #127 repaired same-generation retries that retained an outdated source manifest. Gebiet 7 was previously accepted with 788 Streets and 1,737 Houses. A local rectangular Gebiet-8 BBox replay reached `ready` under the 50-query wrapper, but local SQLite does not establish the exact private Area or Cloudflare D1 limits.
- `STREET_ENGINE_LIVE_READY=FALSE` until Gebiet 8 reaches `ready` on exact-commit Beta, Streets/Houses render, reload is stable, a second client converges and Gebiet 7 remains correct.

Continue with [Plan 042](../plans/active/042-v4-large-area-staged-preparation.md). No Production/Main deploy, Production D1 mutation, secret rotation, V3/V2 runtime fallback or live Overpass fallback.

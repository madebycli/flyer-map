---
id: plan-054-scale-independent-loading
type: plan
status: planned
last_updated: 2026-10-12
---

# Plan 054 — the same speed and data use for 10, 1 000 and 100 000 houses

**Status: PLANNED / NOT IMPLEMENTED** (only the first measurements and the render fixes below are built). The owner's goal (2026-10-12): no difference in loading time or performance between 10, 1 000 and 100 000 houses and streets, and little data use, because many people use the site on mobile data.

## What is measured, what is not

Measured in the sandbox (Chromium, CPU throttled 4×, software GL; city of 24 207 houses, 61 616 street pieces, `scripts/v5-e2e/perf.mjs`) and from two diagnostic reports of one Android phone (24 156 houses in 15 parts; later 581 houses in 1 part with 48 416 stored statuses). **Not measured:** the real mobile-data volume of a first start, a real Overpass answer, a real D1.

## Where the size of the city still costs (state after `2911b9b`)

| What | Grows with the number of houses? | State |
|---|---|---|
| Drawing the map | no, only with the visible part | statuses are cut into the tiles by the engine, low-zoom tiles are thin (z11 tile 1.8 MB → 0.22 MB), streets from z14, pixel ratio ≤ 2 (`00ce2a0`, `2911b9b`) |
| Download of the map data | yes | raw OSM pack ≈ 24 MB uncompressed for 24 000 houses (compressed size and real mobile volume not measured) |
| Start from the device cache | yes | 34 MB of cached blobs were all loaded into the engine before the map showed (4 s on the phone); cached parts now count half against the first-step budget (`FIRST_UNITS`), the rest follows behind the map |
| Statuses in store, IndexedDB and sync | yes | 48 416 entries on the phone, also for houses that are not loaded |
| Overview and progress numbers | yes | computed on the device over all houses |

## Design

**Step 0 — measure the data.** Add the bytes of every pack, blob, tile and sync request to the diagnostic report (`res.*` already counts resources; add per-kind totals and the first-start total) so the goal is a number.

**Step 1 — load only what is needed.** The Gebiet is already cut into parts of a fixed grid (Plan 052). The device loads the parts that are in or near the view and those of its own team's Gebiete; the others only when zoomed to. Statuses are pulled only for loaded parts (and kept only for them). Needs: the state pull filtered by Gebiet first (`v5_state.area` exists), then by part (a `part` column / cell id, additive migration — proposal `0030`, **not written**). Team links and collectors already load only their Gebiete (`worksInSome`).

**Step 2 — progress from the database.** The overview shows counts per Gebiet and part that the server delivers (maintained when ops are accepted), not a calculation over every house on the device.

**Step 3 — levels of detail.** Below about z15 the map shows a progress grid of fixed size (cells with done/total), independent of the number of houses; above it the real houses of the visible tiles. This replaces the idea "render an image and swap tiles on edit": a grid of counts is cheap to update per change and works offline.

## Limits (stated, not hidden)

- Someone who wants to work offline must load the Gebiet beforehand: the cost is proportional to their own Gebiet, never zero.
- A dense city centre has more houses in one view than a village; "equal" can only be approached.
- Worker stays TypeScript (ADR-0035); permissions stay server-authoritative (a part filter is never a permission).
- Cloudflare D1 free tier: the daily row-write limit stopped two deploys (migration step) and very probably the phone's sync (`500 write_failed`) on 2026-10-11; every extra write path counts.

## Open decision (owner)

Must the map keep working offline in parts that were never opened? If **yes**: a "load Gebiet beforehand" step stays. If **no**: the server can deliver tiles and progress directly and the data volume becomes smaller and constant. Until decided, build steps 0 and 1 (both are needed either way).

## Acceptance (to be written as tests)

- Synthetic cities of 10, 1 000 and 100 000 houses (`CITY_BLOCKS`, `perf.mjs`): bytes and time of a first start for the same Gebiet size or the same view stay within a stated factor; long tasks per pan do not grow with the city.
- State pull for a team link transfers only that team's Gebiete (server test).
- Overview numbers equal the per-house calculation (property test).

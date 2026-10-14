---
id: plan-054-scale-independent-loading
type: plan
status: planned
last_updated: 2026-10-12
---

# Plan 054 — the same speed and data use for 10, 1 000 and 100 000 houses

**Status: PARTLY BUILT.** Built: render fixes (`00ce2a0`, `2911b9b`), parts around the last view first (`b6eafe7`), step 2's server side (below). Loading parts on demand (step 1) is built too. Not built: a progress grid for the levels of detail (step 3; per-part done counts do not exist on the server), the offline decision. The owner's goal (2026-10-12): no difference in loading time or performance between 10, 1 000 and 100 000 houses and streets, and little data use, because many people use the site on mobile data.

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

## Built so far (2026-10-12)

- **Start order** (`src/v5/app/lastView.ts`): the view is kept per Aktion on the device; a staged start derives the parts nearest to it first.
- **Server aggregates** (`worker/v5/areaStats.ts`, migration `0030_v5_area_stats.sql`, additive, applied only to the dedicated Unstable D1 by the pipeline): `PUT /areas/stats` (admins; a device reports how many houses and street pieces each unit has, only when that changed since its last report because every report is a write) and `GET /progress` (per Gebiet the person may read: reported size while the pack version matches, plus done / later / not deliverable counted in the database). Tests: `tests/v5AreaStats.test.ts`.
- **Overview** (`withServerProgress` in `src/v5/app/stats.ts`): while parts of a Gebiet are still arriving after a staged start, the overview takes that Gebiet's numbers from the server — only when the server knows all its units, else the local numbers stay. Refreshed every 20 s while the overview is open.
- Not measured on a device. `/progress` reads the `v5_state` rows of the Aktion once per call (an aggregate over an index): the D1 read cost of an overview with many thousands of statuses is not measured yet.
- **Loading parts on demand** (`useCampaign.ts`, `lastView.ts`): a Gebiet or Aktion of more than 8 units (`LAZY_FROM`) is loaded part by part. A start derives the parts of the last visits (`vf-v5-parts-<campaign>`, at most 40) and the ones around the last view; when the view is at zoom 14 or closer, parts that come into it (grown by 25 %) are added and the map reloads quietly with the larger set (the engine is replaced, tiles refresh). Only wanted parts are downloaded or read from the device cache. New parts (a Gebiet just built) are wanted at once. A banner says "x von y Kartenteilen geladen". `?parts=all` loads everything (tests, comparisons). Orphan clean-up and pruning stay off while parts are missing. Flow: `scripts/v5-e2e/flow23.mjs` (needs `BIG_AREA=1`; start with 4 of 17 parts, 16 after looking around, none fetched twice, the next start brings them back).
- **Whole-Aktion numbers** (pill and overview) come from the server once it knows the size of every unit (`coveredByServer`); until then they count the loaded parts and the banner says so. A device reports only the units it derived, so the sizes complete as parts are visited. **Open:** one admin action that derives and reports all units once ("Gebietsgrößen vollständig melden") so everybody gets the whole numbers at once.
- **Not done:** the camera does not return to the last view at start (it fits the Gebiete); statuses are still pulled for the whole Aktion (a part filter on the state pull is the next saving); no levels of detail yet, so at zoom below 14 unloaded parts look empty.

## Built on 2026-10-14

- **The camera opens where the person looked last** when the Aktion is loaded part by part (those are the parts on the device); otherwise it fits all Gebiete as before.
- **Parts that are not on the device** are drawn as quiet dashed squares below zoom 14, so an empty place is not read as "nothing here" (`v5-unloaded` layers).
- **"Alle Teile einmal berechnen"** (overview, admins, only while the numbers count loaded parts only): derives every part that is not on the device once in a throw-away engine, keeps the blob in the device cache, reports the sizes; afterwards pill and overview count the whole Aktion although only some parts are loaded. Flow: `scripts/v5-e2e/flow24.mjs` (needs `BIG_AREA=1`).
- **Data in the diagnostics:** the sheet shows the total transferred (own files and server data); a finding appears above 20 MB. The basemap is another host and not measurable from the page.
- **Server cost of the aggregates:** `GET /progress` reads every done row of the Aktion, so the answer is kept 30 s per Worker instance (dropped by a report or a pack build) and the device asks every 30 s with the overview open, every 2 min otherwise.

## D1 write budget (why a day can run dry)

Measured by two failed deploys on 2026-10-11/12 (Cloudflare code 7500: free tier, daily row writes, reset at midnight UTC). A status write touches the table row, its primary-key index and two explicit indexes (≈ 3–4 row writes) plus the sequence counter per batch: about 25 000 marks fill a day of 100 000 row writes. Ideas, none built: `WITHOUT ROWID` for `v5_state` before any production apply (one B-tree less, ≈ −25 %; a rebuild of the Unstable table would cost more writes than the day allows), or the paid Workers plan. Note for tests with many marks: spread them over days or expect the pipeline's migration step to fail until midnight UTC.

## Decided against, for now

- **A part filter on the state pull:** needs a `part` on every state row, a backfill and a per-part cursor so that a part loaded later gets its older statuses; the saving is the one-time status download (≈ 5 MB uncompressed for 48 000 statuses, far less compressed) against a sync-protocol change. The pack download is the big item and is already on demand.
- **Tinting Gebiete by progress at low zoom:** would reach into the Gebiet editor's map code for a nice-to-have; the overview already shows the percentages.

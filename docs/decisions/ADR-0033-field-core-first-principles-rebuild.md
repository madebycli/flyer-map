---
id: adr-0033-field-core-first-principles-rebuild
type: decision
status: proposed
last_updated: 2026-10-08
---

# ADR-0033 — Field core from first principles: measured findings and proposed rebuild

## Context

Field feedback on Beta: the app is laggy and buggy, loading the map with many
areas is slow, Smart Marking skips streets or marks forest paths. Patching
single symptoms for weeks (plans 034–042, V3 → V4 pipelines) has not changed
that. This ADR records what was *measured* before deciding what to demolish.

## Measurements (headless Chromium, software WebGL, MapLibre 5.7.1)

Synthetic polygon grid, one status change on one feature, main-thread time of
the call (rendering time is software-GL bound and not comparable):

| Houses | `setData()` full | `updateData()` diff | `setFeatureState()` |
|---|---|---|---|
| 2 000 | 2–6 ms | 0.1–0.4 ms | 0.1–0.2 ms |
| 20 000 | 22–29 ms | 0.1–0.4 ms | 0.1–0.2 ms |

`setData` scales linearly with the whole dataset (≈250 ms extrapolated at 200 k
on a fast CPU, several times worse on phones, plus a worker re-tile).
`updateData` and feature-state are flat. Conclusion: the map update path is not
the remaining bottleneck once it is incremental (done in this branch).

Sync → UI: every RxDB replication event rebuilt the *entire* Campaign snapshot
(`toJSON` + validation + sort + metadata strip for every document). At 20 000
Houses that is ≈170 ms of main-thread work per event on a fast server CPU
(clone+narrow ≈140 ms, materialize ≈20–40 ms), and every consumer received
20 000 fresh object identities. Per-document caching was added in this branch.

## Findings (root causes, not symptoms)

1. O(total) work per change at every layer: snapshot materialization, React
   props (`App.tsx` passes ~40 props into `MapView`), GeoJSON rebuild.
2. Smart road connectivity only linked ways via *endpoints*; side streets
   joining at interior nodes were "disconnected" (fixed here).
3. The road allow-list admitted `path`/`footway`/`track`-like ways without
   surface/access/footway-kind checks (fixed here, plan 038 phase 1 subset).
4. Tasks are *materialised* from OSM by a heavy server pipeline (Durable
   Object alarms, leases, staged generations, D1 batches, source packs). Every
   street/house becomes a synced database row, although it is a pure function
   of OSM data plus a small amount of user state.

## References

- MapLibre/Mapbox guidance: for large data prefer vector tiles over GeoJSON;
  use `promoteId` + feature-state for per-feature state changes.
- Protomaps/PMTiles: single-file tile archives served from object storage
  (R2) through a Worker; Planetiler/tilemaker build them from OSM extracts.
- OSMnx/pyrosm: whitelist `highway` values instead of long exclusion lists;
  exclude `service=driveway|parking_aisle|alley`, `track`, `footway=sidewalk|crossing`.
- Vela (design only): Google-Maps-like floating round controls, teal accent,
  tonal light/dark surfaces.
- No open-source OSM canvassing/flyer app with offline sync was found; this
  domain has no off-the-shelf reference implementation.

## Proposed direction (needs owner decision)

**Derive, don't materialise.** Persist only Areas, per-segment/per-house
*status overlays* keyed by stable OSM ids (way id + measure range, building
id), and comments. Streets and houses come from a delivery-filtered tile
source (PMTiles on R2, whitelist classification, junction-noded segments) and
are painted by data-driven styling from a compact status map
(`promoteId` + feature-state). Sync then moves status deltas, not entity
graphs; the DO/D1 preparation pipeline and generation machinery disappear.

Open decisions: (a) new infrastructure (R2 + a tile build job) contradicts
plan 035 "no new services"; (b) migration of existing Task ids to OSM-keyed
overlays; (c) real-device acceptance (ADR-0030) cannot be done from CI.

## Consequences

Kept: Cloudflare Worker/D1, auth/organisations/admin, MapLibre 5.7.1.
Replaced (if accepted): street engine V3/V4 preparation, per-entity task sync.

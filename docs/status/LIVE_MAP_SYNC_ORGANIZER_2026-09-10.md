# Live Map / Sync / Organizer recovery - 2026-09-10

## User-verified priority

1. Map application/basemap layers are missing. The MapLibre map module/surface itself is visible.
2. Sync still overwrites the user's current/local state after synchronization instead of converging safely.
3. Fresh Organizer login can enter a Campaign/Map with only Team/Field-Group scope, losing Organizer authority.

## Critical correction

Master clarified that the map module itself is visible and **the layer pipeline is the failure**. Do not treat this as a container, sizing or generic MapLibre mount problem.

The first recovery attempt was too aggressive because it always replaced the healthy OpenFreeMap Bright style with a minimal fallback. That would itself discard normal provider layers.

The corrected candidate now:

- fetches and preserves the real Bright style when it is healthy;
- verifies the required `openmaptiles` source and at least one symbol insertion layer;
- falls back only after a provider transport failure, HTTP failure or structurally unusable style;
- keeps a minimal raster layer plus `openmaptiles` and a symbol anchor only for that fallback case;
- leaves unrelated fetches unchanged.

Implementation checkpoint: `b31c17abb816d0f7f64799775d6d6ab99ca27139`.
Regression-test checkpoint: `9073fbda2948ffa41c317a6804a4df73e9366db6`.

This is a code-level candidate, not yet a live PASS. Real staging still has to prove that the expected map layers are visible.

## Execution contract

- Fix order: map layers, then Sync, then Organizer authority.
- Every meaningful fix/checkpoint is committed to GitHub immediately before moving to the next issue.
- Do not accumulate all fixes locally before pushing.
- Preserve user data and current server state.
- No Production deploy, Production D1 migration, secret rotation or automatic merge.

## Map-layer acceptance

A map-layer fix is PASS only when the real field map shows the expected basemap and saved Area/Street/House layers and survives reload. A visible MapLibre container alone is not PASS.

## Sync acceptance

A Sync fix is PASS only when server/client convergence no longer reverts a valid newer local/user mutation after refresh/sync, including delete/tombstone cases.

## Organizer acceptance

A fresh Organizer login must retain Organizer/campaign-wide authority when opening its Campaign/Map. A Team/Field-Group access link or stale client scope must not silently downgrade the authenticated Organizer principal.

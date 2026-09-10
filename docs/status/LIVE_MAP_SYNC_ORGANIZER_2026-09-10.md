# Live Map / Sync / Organizer recovery - 2026-09-10

## User-verified priority

1. Map application/basemap layers are missing. The MapLibre map module/surface itself is visible.
2. Sync still overwrites the user's current/local state after synchronization instead of converging safely.
3. Fresh Organizer login can enter a Campaign/Map with only Team/Field-Group scope, losing Organizer authority.

## Critical correction

Master clarified that the map module itself is visible and **the layer pipeline is the failure**. Do not treat this as a container, sizing or generic MapLibre mount problem.

The temporary basemap-recovery shim introduced on 2026-09-10 is now withdrawn. It changed the established startup path by intercepting the global `fetch` used for the OpenFreeMap Bright style and substituting a synthetic fallback style on selected failures. Because the missing-layer regression appeared while this path was active, the safest recovery is to restore the previously established map startup before changing any more rendering behavior.

Restored map startup contract:

- `src/main.tsx` no longer installs or imports a map-style fetch interceptor;
- `MapView` again lets MapLibre load `https://tiles.openfreemap.org/styles/bright` directly through `OPENFREE_MAP_STYLE_URL`;
- Area, Street and House overlay source/layer logic remains in place;
- Street/House network rendering and Sync fixes are not rolled back by this map-only recovery;
- the unused `src/map/mapStyleRecovery.ts` shim is removed.

Rollback checkpoints:

- `9dd334b94d3d3c2331843481c4ba5c16af26dffd` restores direct MapLibre basemap startup;
- `13b51717e9f175b99a13482b473057faf3a73d6c` locks the restored startup contract in tests;
- `8aa59a559f5882f5d44d173095db0dbdb8a204d2` removes the abandoned recovery shim.

This is still a code-level recovery, not a live PASS. Real staging must prove that the expected basemap and saved campaign overlays are visible after reload.

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

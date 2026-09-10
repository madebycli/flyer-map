# Live Map / Sync / Organizer recovery - 2026-09-10

## User-verified priority

1. Map application layers are missing. The map surface/module itself is visible.
2. Sync still overwrites the user's current/local state after synchronization instead of converging safely.
3. Fresh Organizer login can enter a Campaign/Map with only Team/Field-Group scope, losing Organizer authority.

## Critical correction

The initial map hypothesis on this recovery branch was too broad. Master clarified that the map module/base surface is visible and **only the expected map/application layers are missing**. Do not treat this as a generic invisible-map/container problem.

The experimental `mapStyleRecovery` fallback committed earlier on this branch is therefore **not accepted as the fix** until layer-specific evidence proves it is needed. Prefer restoring the existing Bright basemap contract and diagnose why application sources/layers do not render or receive canonical data.

## Execution contract

- Fix order: map layers, then Sync, then Organizer authority.
- Every meaningful fix/checkpoint is committed to GitHub immediately before moving to the next issue.
- Do not accumulate all fixes locally before pushing.
- Preserve user data and current server state.
- No Production deploy, Production D1 migration, secret rotation or automatic merge.

## Map-layer acceptance

A map-layer fix is PASS only when the real field map shows the expected saved Area/Street/House layers on top of the basemap and survives reload. A visible MapLibre container or basemap alone is not PASS.

## Sync acceptance

A Sync fix is PASS only when server/client convergence no longer reverts a valid newer local/user mutation after refresh/sync, including delete/tombstone cases.

## Organizer acceptance

A fresh Organizer login must retain Organizer/campaign-wide authority when opening its Campaign/Map. A Team/Field-Group access link or stale client scope must not silently downgrade the authenticated Organizer principal.

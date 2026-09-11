# Live Map / Sync / Organizer Recovery

Status: active, user-reported regressions, fixes must be committed incrementally.

Branch: `fix/live-map-sync-organizer-2026-09-10`
Base: `integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209`

## Mandatory priority

1. Restore Map visibility first.
2. Fix Sync so a refresh/synchronization cannot overwrite newer canonical server state with stale local state.
3. Verify and fix Organizer authorization loss when opening the Map from a fresh Organizer login.

## User-reported evidence

- Map can be missing/invisible in the field UI.
- Sync still reverts changes and can reintroduce stale/deleted state after refresh.
- A freshly logged-in Organizer opened the Map and was treated as if only a Team/Group link grant existed. Organizer-level authorization was absent from the Map session.

These reports are release-blocking until reproduced or disproved with exact runtime evidence.

## Working rules

- Every completed fix is committed directly to GitHub before starting the next fix.
- Do not batch all three fixes into one unpublished local change set.
- Keep intermediate commits as recovery checkpoints.
- No Production deploy, Production D1 migration, merge, or secret rotation is authorized by this recovery task.
- Preserve server authority, Organization capability semantics, same-origin security, D1 canonical state, and RxDB convergence invariants.

## Next checkpoint

Inspect current Map composition and CSS/runtime mounting first. Patch only after identifying a concrete visibility failure path and add a regression test with the same commit.

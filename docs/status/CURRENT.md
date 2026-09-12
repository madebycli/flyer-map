---
id: status-current
type: status
status: active
last_updated: 2026-09-12
---

# Current Project State

## Authoritative PR #92 checkpoint

- Repository: `madebycli/flyer-map`.
- Branch: `fix/street-engine-smart-marking`.
- Draft PR: #92, open, draft and unmerged; base `integration/main-street-runtime`.
- Exact current branch head: `6e381da46547a2586b6ae726003a5c795542badf`.
- The current UI slice keeps the existing red Danger color and renders Street delete as a compact trash-icon action with the same footprint as the comment action. It has an accessible label/title and no data or migration change.
- MapLibre GL JS `5.7.1` and `@mapbox/unitbezier` `0.0.1` are committed for controlled isolation. MapLibre `6.9.0` is historical/comparison context, not the current branch pin.
- Normal CI: run `34694648836`, job `103555926689`, success. Tests, typecheck, dependency audit and production build passed.
- Isolation: run `34694647237`, job `103555922252`, success. The workflow verified the committed `5.7.1` / `0.0.1` dependency pair.
- Admin staging: run `34694647278`, job `103555922438`, success. The exact branch commit was deployed and shell/API smoke checks passed.
- Staging URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.

## Safety and acceptance gates

- No merge, Production deploy, Production change, remote-D1 migration, remote-D1 write or secret rotation was performed.
- `MAP_RENDER_P0 = OPEN` and `STREET_ENGINE_LIVE_READY = FALSE` remain correct until the real iPad Safari test confirms visible Area and Street geometry. Green CI or a successful staging shell check does not close that device gate.
- Existing direct Source seeding remains the runtime approach. No new GeoJSON lifecycle/timing hack or `GeoJSONSource.setData()` monkey-patch was introduced.
- The known real-device acceptance target remains the seeded geometry values: `appliedAreas = 4`, `appliedStreets = 343`, `appliedHouses = 1233`, with `queued* = null`, followed by actual visible Area/Street geometry.

## Context maintenance

The current branch/runtime facts above supersede older feature-branch, PR #76,
MapLibre `6.9.0` candidate and pre-`6e381da` staging entries in historical
handoffs and audits. Those entries remain historical evidence and must not be
read as the current branch state.

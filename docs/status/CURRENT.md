## Authoritative analysis checkpoint - 2026-09-12

The current branch is fix/street-engine-smart-marking. This documentation
checkpoint follows the last fully verified runtime head
3e1dfb409cb63381b9a7154cd3a941252da95263. The completed audit masterplan is
docs/status/STREET_ENGINE_D1_AUDIT.md at documentation commit
e6641486e40806001c50bcf488df438093bb46b1.

The audit keeps the 4.5M D1 Rows Read attribution open, narrows the visible
StreetEngine failure to Buildings at cursor 0 after the 40 percent progress
screen, and records the confirmed edge-staging reread hotspot. It also adds
the requested Area draw/edit UX contract: one compact Street-style header,
undo, cancel, approved/validity state, visible point count and maximum, and
a confirm action gated by geometry validity. Comments are specified as a
same-button toggle with no separate "Kommentare schließen" button and with
the Field-HUD size, position, snap and minimum-height rules adjusted
together.

No runtime fix, migration, production action or remote D1 write was made by
this checkpoint. Last full exact-head evidence remains the CI and staging
evidence recorded for 3e1dfb4. Local focused tests were 50/50; local full
tests were 868/869 because of the sandbox broadcast-channel EPERM, and local
typecheck hit the environment's missing /proc/self/exe path. Do not treat
those local caveats as a product failure or as a full local PASS.

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
- Exact last verified product/deploy head: `a3479f5bd0825f120fa8ae0d5e3d048d54fb6237`.
- The current UI slice keeps the existing red Danger color and renders Street delete as a compact trash-icon action with the same footprint as the comment action. Street status actions keep an equal-width 2x2 grid, while compact comment/delete actions are stacked vertically in the adjacent action column. The House status grid is unchanged. It has an accessible label/title and no data or migration change.
- MapLibre GL JS `5.7.1` and `@mapbox/unitbezier` `0.0.1` are committed for controlled isolation. MapLibre `6.9.0` is historical/comparison context, not the current branch pin.
- Normal CI: run `34708939943`, job `103594017969`, success. Tests, typecheck, dependency audit and production build passed.
- Isolation: run `34708938074`, job `103594012867`, success. The workflow verified the committed `5.7.1` / `0.0.1` dependency pair.
- Admin staging: run `34708938075`, job `103594012869`, success. The exact branch commit was deployed and shell/API smoke checks passed.
- Staging URL: `https://flyer-map-admin-staging.cloudflare-eleven035.workers.dev`.

## Safety and acceptance gates

- No merge, Production deploy, Production change, remote-D1 migration, remote-D1 write or secret rotation was performed.
- `MAP_RENDER_P0 = OPEN` and `STREET_ENGINE_LIVE_READY = FALSE` remain correct until the real iPad Safari test confirms visible Area and Street geometry. Green CI or a successful staging shell check does not close that device gate.
- Existing direct Source seeding remains the runtime approach. No new GeoJSON lifecycle/timing hack or `GeoJSONSource.setData()` monkey-patch was introduced.
- The known real-device acceptance target remains the seeded geometry values: `appliedAreas = 4`, `appliedStreets = 343`, `appliedHouses = 1233`, with `queued* = null`, followed by actual visible Area/Street geometry.

## Context maintenance

The current branch/runtime facts above supersede older feature-branch, PR #76,
MapLibre `6.9.0` candidate and pre-`a3479f5` staging entries in historical
handoffs and audits. Those entries remain historical evidence and must not be
read as the current branch state.

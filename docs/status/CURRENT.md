---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization is merged on `main`; production D1 migration `0002_m4_access.sql` is applied and `M4_BOOTSTRAP_SECRET` is configured.

Current follow-up is PR #21 (`renderer-access-recovery`): Admin access recovery + whole-city saved-geometry renderer + diagnostics/UI cleanup.

## Map

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers created as part of the initial style;
- actual Campaign data changes update those sources through `setData()`;
- active draw/edit only in SVG;
- stored edit points hidden in browse;
- no application projection loop over saved geometry during normal pan/zoom/rotate.

MapLibre 6.4.1 is not the baseline: real-browser testing showed saved GeoJSON becoming invisible/non-interactive despite healthy FPS. The 5.7.1 pin restored the working direction and is now documented as the current base.

## Current access

Current Campaign roles remain:
- Admin;
- Team Editor scoped to one Team;
- Viewer.

Campaign id is only a selector. Access/session authorization is Worker-enforced. PR #21 adds operator Admin recovery using the configured server-only bootstrap/recovery secret.

## PR #21 state

Repository-controlled implementation/documentation gates are healthy on runtime head `3232e9e180fb3e2706278157e6fabccf0c4efeac`:
- GitHub Actions CI #169 passed;
- Cloudflare deployed the exact head successfully as preview;
- ADR/deployment/production documentation matches the initial-style GeoJSON lifecycle used by the code.

Real-browser acceptance on that runtime-equivalent preview has confirmed:
- saved Area remains visible/selectable after Save;
- saved Street remains visible/selectable after Save;
- pan/zoom/rotate behavior is good and saved geometry remains aligned with the basemap;
- Area edit handles are active-only and usable;
- mobile bottom toolbar and safe-area behavior are acceptable.

Desktop bottom-toolbar fit is explicitly **not accepted yet**. The user reported that the PC layout still needs work and chose to defer that desktop-specific fix until later. Do not infer desktop acceptance from the mobile result.

Acceptance-note commits only change documentation; they still require normal CI + exact Cloudflare preview deployment, while prior runtime browser results remain applicable because application/runtime code did not change.

Do **not** merge until the remaining gates are resolved: desktop toolbar fit, Admin recovery on the target origin, diagnostics output, and representative dense Street datasets at 500 / 1,000 / 2,500 / 5,000 features (or a concrete documented blocker).

## Active plans

- `docs/plans/active/008-renderer-access-recovery.md` — remaining external browser/device acceptance + final PR #21 merge gate.
- `docs/plans/active/009-product-platform-foundation.md` — ordered next-platform plan after PR #21 is merged and production is healthy.

## Accepted next roadmap

See `docs/product/ROADMAP.md`.

Order:
- M5 resilient mutation synchronization;
- M6 Smart Street + House Tasks using reviewed real map geometry instead of freehand tracing as the normal path;
- M7 comments, activity and deterministic automations;
- M8 Organizations, multiple admins and separate Admin panel;
- M9 statistics/reporting + personal UI light/dark/system appearance;
- M10 field hardening/release.

Organization and collaboration/statistics architecture are currently **proposed**, not implemented.

## Immediate next

1. Let CI and Cloudflare preview verify the documentation-only acceptance-note head.
2. Continue remaining acceptance without repeating already-passed mobile/map/edit checks; desktop toolbar remains explicitly deferred.
3. If all remaining gates pass or are resolved with an accepted documented blocker, move Plan 008 to completed, merge PR #21, verify production, then start M5 from Plan 009 on a fresh branch from current `main`.

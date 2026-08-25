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
- saved Areas/Streets in MapLibre GeoJSON sources/layers;
- active draw/edit only in SVG;
- stored edit points hidden in browse;
- no application projection loop over saved geometry during normal pan/zoom/rotate.

MapLibre 6.4.1 is not the baseline: real-browser testing showed saved GeoJSON becoming invisible/non-interactive despite healthy FPS. The 5.7.1 pin restored the working direction and is now documented as the current base.

PR #21 still needs final interaction/dense-data acceptance before merge.

## Current access

Current Campaign roles remain:
- Admin;
- Team Editor scoped to one Team;
- Viewer.

Campaign id is only a selector. Access/session authorization is Worker-enforced. PR #21 adds operator Admin recovery using the configured server-only bootstrap/recovery secret.

## Active plans

- `docs/plans/active/008-renderer-access-recovery.md` — finish PR #21 acceptance/merge.
- `docs/plans/active/009-product-platform-foundation.md` — ordered next-platform plan after the current slice.

## Accepted next roadmap

See `docs/product/ROADMAP.md`.

Order:
- M5 resilient mutation synchronization;
- M6 Smart Street + House Tasks using reviewed real map geometry instead of freehand tracing as the normal path;
- M7 comments, activity and deterministic automations;
- M8 Organizations, multiple admins and separate Admin panel;
- M9 statistics/reporting + personal UI light/dark/system appearance;
- M10 field hardening/release.

Organization and collaboration/statistics architecture are currently **proposed**, not implemented. Their constraints live in `docs/architecture/ORGANIZATIONS.md` and `docs/architecture/COLLABORATION.md`.

## Immediate next

1. Finish PR #21 browser/phone acceptance and desktop toolbar polish.
2. Merge/deploy only when current renderer/access behavior is confirmed.
3. Start M5 from the accepted baseline; do not mix Organization/Admin/Statistics rewrites into the renderer branch.

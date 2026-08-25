---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization is merged on `main`; production D1 migration `0002_m4_access.sql` is applied and `M4_BOOTSTRAP_SECRET` is configured.

PR #21 (`renderer-access-recovery`) contains the accepted post-M4 renderer/access baseline and is in final closeout. Plan 008 is completed; after the final documentation head receives green CI + exact Cloudflare preview, merge PR #21 and verify production.

## Map

Current renderer baseline:
- MapLibre GL JS **5.7.1 pinned**;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in persistent MapLibre GeoJSON sources/layers created as part of the initial style;
- actual Campaign data changes update those sources through `setData()`;
- active draw/edit only in SVG;
- stored edit points hidden in browse;
- no application projection loop over saved geometry during normal pan/zoom/rotate.

MapLibre 6.4.1 is not the baseline: real-browser testing showed saved GeoJSON becoming invisible/non-interactive despite healthy FPS. The 5.7.1 pin restored the working direction.

## Current access

Current Campaign roles remain:
- Admin;
- Team Editor scoped to one Team;
- Viewer.

Campaign id is only a selector. Access/session authorization is Worker-enforced. PR #21 adds operator Admin recovery using the configured server-only bootstrap/recovery secret.

## Plan 008 acceptance

Real-browser/mobile acceptance confirmed:
- saved Area visible/selectable after Save;
- saved Street visible/selectable after Save;
- pan/zoom/rotate alignment;
- active-only usable Area edit handles;
- mobile bottom toolbar and safe-area behavior.

Repository-controlled acceptance also confirms the MapLibre source/layer lifecycle, Admin-recovery unit coverage, diagnostics implementation, green CI and exact Cloudflare preview deployment on the accepted runtime/documentation heads.

Two non-passed follow-ups are deliberately tracked rather than hidden:
- GitHub #22 — desktop bottom-toolbar fit/spacing; explicitly deferred for later;
- GitHub #23 — deployed-origin Admin recovery smoke, real-browser `?diag=1`, and 500 / 1,000 / 2,500 / 5,000 Street device/browser stress validation.

Neither follow-up should be described as already passed.

## Active plan

- `docs/plans/active/009-product-platform-foundation.md` — ordered next-platform plan; start M5 only after PR #21 is merged and production is healthy.

Completed current slice:
- `docs/plans/completed/008-renderer-access-recovery.md`.

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

1. Verify final PR #21 closeout head with CI and exact Cloudflare preview.
2. Merge PR #21.
3. Verify production deployment/health.
4. Start M5 from Plan 009 on a fresh branch from current `main`.
5. Keep #22 and #23 visible as deferred quality/operations work; they do not become passed by merging PR #21.

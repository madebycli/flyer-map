---
id: status-current
type: status
status: active
last_updated: 2026-08-25
---

# Current Project State

## Baseline

M4 access/session authorization and PR #21 (`renderer-access-recovery`) are merged on `main`. PR #21 merged as `63ea2e9c1e289b0c149fa4e229df6d02b81ef51d` on 2026-08-25 and Plan 008 is completed.

Production D1 migration `0002_m4_access.sql` is applied and `M4_BOOTSTRAP_SECRET` is configured outside the repository.

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

Campaign id is only a selector. Access/session authorization is Worker-enforced. Operator Admin recovery uses the configured server-only bootstrap/recovery secret and creates normal revocable access/session records.

## Plan 008 acceptance

Real-browser/mobile acceptance confirmed before merge:
- saved Area visible/selectable after Save;
- saved Street visible/selectable after Save;
- pan/zoom/rotate alignment;
- active-only usable Area edit handles;
- mobile bottom toolbar and safe-area behavior.

Repository-controlled acceptance confirmed the MapLibre source/layer lifecycle, Admin-recovery unit coverage, diagnostics implementation and green CI. Final PR head `791d8590f94efef2236968a8d7542d6d56123200` passed CI #175 and Cloudflare deployed that exact head successfully as a preview before merge.

## Known follow-ups

Two non-passed follow-ups are deliberately tracked rather than hidden:
- GitHub #22 — desktop bottom-toolbar fit/spacing; explicitly deferred for later;
- GitHub #23 — post-merge production health/deployed-origin Admin recovery smoke, real-browser `?diag=1`, and 500 / 1,000 / 2,500 / 5,000 Street device/browser stress validation.

Neither follow-up should be described as already passed. The current coding environment cannot resolve the public `workers.dev` production hostname, so live production health is not independently claimed here.

## Active plan

- `docs/plans/active/009-product-platform-foundation.md` — ordered next-platform plan.

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

1. Confirm the public production endpoint/health for the merged `main` baseline when an environment with `workers.dev` network access is available; this is tracked in #23.
2. Once production health is confirmed, start M5 from Plan 009 on a fresh branch from current `main`.
3. Keep #22 and #23 visible as deferred quality/operations work; merging PR #21 did not convert them into passed checks.

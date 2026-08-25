---
id: product-mvp
type: product
status: accepted
last_updated: 2026-08-25
related: [product, product-roadmap, product-ux]
source_of_truth_for: [release-scope, field-readiness]
---

# MVP / Release Scope

## Release goal

A reliable mobile-first website that can be used for a real city-scale flyer distribution Campaign on common Android phones and iPhones while remaining safely manageable by coordinators.

## Current baseline must remain

- website-only delivery;
- crisp interactive map with rotation/compass;
- on-demand device location without route tracking;
- Campaigns/Aktionen with shared map focus;
- personal last map view per Campaign/browser;
- Teams and Areas;
- saved distribution Tasks and explicit statuses;
- shared D1 state;
- revocable Campaign-scoped access;
- Worker-enforced Admin / Team Editor / Viewer roles;
- in-page remote refresh without camera reset;
- active unsaved draw/edit protected from remote replacement;
- German and English UI;
- saved dense geometry rendered in the map engine rather than per-frame React/SVG projection.

## Expanded release direction

The product roadmap now includes capabilities required for the intended reusable platform rather than treating the early single-Campaign demo as the end state:

- M5 resilient mutation synchronization;
- M6 Smart Street + House Tasks;
- M7 comments/activity/automations;
- M8 Organizations + multiple admins + Admin panel;
- M9 statistics/reporting + UI appearance themes;
- M10 field hardening/release.

See `docs/product/ROADMAP.md` for detailed scope and ordering.

## Release-critical product expectations

Before final city/organization release:
- normal street work should use real road geometry rather than approximate freehand tracing where map data is available;
- building-level work should be possible through House Mode where required;
- important offline/reconnect mutations must not silently disappear;
- comments/activity should make shared operational state understandable;
- statistics must reconcile to domain state/events;
- multiple authorized admins and organization tenant boundaries must be server-enforced;
- the field map must remain lightweight even when admin functionality grows;
- UI light/dark/system preference must remain personal and accessible;
- no continuous GPS surveillance is introduced for reporting.

## Non-goals unless a later ADR changes them

- native app-store applications;
- installable PWA mode;
- service worker;
- Background Sync API;
- continuous GPS route history;
- automatic completion merely because a device moved through a street;
- unnecessary social-profile system;
- decorative motion/marketing effects;
- basemap dark mode as a prerequisite for UI dark mode.

## Milestones

- M0 Repository foundation + production website deployment
- M1 Campaign/team/area model
- M2 initial Street Task interaction
- M3 shared persistence with D1
- M4 access links, authorization and field UX/sync hardening
- current renderer/access recovery hardening slice (PR #21)
- M5 resilient mutation queue and synchronization
- M6 Smart Street + House Tasks
- M7 comments, activity and automations
- M8 Organizations, multiple admins and Admin panel
- M9 statistics/reporting and UI appearance
- M10 field testing, hardening and release

## Final release gate

The release is not ready until:
- the same authorized Campaign can be used safely on representative Android and iPhone devices under realistic outdoor connectivity;
- dense city-scale road/building data remains responsive;
- queued mutations recover from short connection loss/reload;
- access/revocation and Organization boundaries are tested server-side;
- progress/statistics values are demonstrably correct;
- admin and field surfaces remain understandable;
- production deployment/recovery/migration runbooks are current.

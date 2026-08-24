---
id: product-mvp
type: product
status: accepted
last_updated: 2026-08-24
related: [product, architecture]
---

# MVP

## Release goal

A reliable field-ready mobile website that can be used for a real flyer distribution Campaign on common Android phones and iPhones.

## Must have

- mobile-first browser interface;
- crisp interactive map with arbitrary rotation and visible compass;
- current device location on demand without route tracking;
- Campaigns/Aktionen with a shared default map focus;
- personal last map view per Campaign/browser;
- named/color-coded Teams;
- assigned map Areas;
- Street distribution Tasks and manual status changes;
- clear progress state;
- shared state across multiple devices;
- revocable Campaign-scoped access links without traditional user accounts;
- Worker-enforced Admin, Team Editor and read-only Viewer roles;
- Team Editor scope enforced server-side, not only through UI visibility;
- remote revision refresh without full-page reload or camera reset;
- 30-second lightweight version polling plus online/visibility/manual checks;
- active unsaved draw/edit/street-draw state must not be silently replaced by remote data;
- short connectivity loss must not silently lose important user changes;
- undo for accidental status changes;
- German and English application UI as a personal browser preference.

## Not required for MVP

- native app stores;
- PWA installation or standalone app mode;
- service worker;
- continuous GPS route history;
- automatic completion based on movement;
- WebSockets;
- advanced analytics;
- email/password accounts;
- OAuth;
- complex organization management;
- durable multi-mutation queue before M5;
- dynamic localization of provider-rendered raster basemap labels;
- decorative motion effects.

## Milestones

- M0 Repository foundation + production website deployment
- M1 Campaign/team/area model
- M2 Distribution task interaction
- M3 Shared persistence with D1
- M4 Access links, authorization and field UX/sync hardening
- M5 resilient mutation queue and synchronization
- M6 Field testing and hardening
- M7 MVP release

## M4 release gate

M4 is not complete until:
- Campaign id alone is insufficient to read/write protected Campaign data;
- revocation works for already-issued sessions;
- Admin/Team Editor/Viewer permissions are enforced by the Worker;
- existing pre-M4 Campaigns can be bootstrapped only through the explicit secured path;
- the D1 migration is intentionally applied without rewriting `0001_initial.sql`;
- Browse Area selection has no edit vertices/white halo, while Edit/Draw still show appropriate SVG points;
- personal camera persistence and shared Campaign focus use the documented priority;
- arbitrary rotation keeps SVG geometry aligned;
- shared updates and manual refresh work without page reload or camera reset;
- active drafts survive discovery of a newer remote revision;
- automated tests, TypeScript and production build are green;
- production health/read-only smokechecks pass.

## MVP release gate

The MVP is not ready until the same Campaign can be used safely in a normal mobile browser on at least one representative Android phone and one representative iPhone under realistic outdoor connectivity conditions.

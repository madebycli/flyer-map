---
id: product-roadmap
type: product
status: accepted
last_updated: 2026-08-25
related: [product, product-mvp, product-ux, architecture-organizations, architecture-collaboration]
source_of_truth_for: [product-roadmap, planned-capabilities, milestone-order]
---

# Product Roadmap

## Baseline

The current product baseline is a mobile-first website with:
- Campaigns/Aktionen;
- Teams and Areas;
- saved Street Tasks;
- shared D1 persistence;
- revocable Admin / Team Editor / Viewer access;
- Campaign map focus and personal camera state;
- MapLibre-rendered saved geometry and SVG-only active editing.

This baseline is intentionally treated as the foundation for the next product generations. New work must extend it without reintroducing per-frame dense-geometry rendering or weakening authorization.

## Product direction

Verteil-Flyer is evolving from a single-Campaign field map into a reusable distribution and collection platform that can support multiple organizations, multiple administrators, better collaboration and trustworthy progress reporting.

The map remains the primary field workspace. Administrative and statistical capabilities should not turn the field view into a desktop-heavy dashboard.

The product should support two related field workflows over time:
- **Distribution / Verteilen** — flyer routes, Areas, Streets/Houses and completion progress;
- **Collection / Einsammeln** — later pickup rounds by car, completed road sections and explicit pickup addresses/houses.

## Planned milestones

### M5 — Resilient synchronization

Goal: important field changes survive unreliable connectivity and reloads while the loaded website remains open.

Planned capabilities:
- durable browser mutation queue (IndexedDB preferred);
- idempotent server-side mutations;
- reconnect/visibility/manual retry;
- conflict states instead of silent last-write-wins;
- authorization/revocation-aware queue handling;
- current snapshot retained as fast startup/recovery cache.

No service worker or Background Sync API.

A full cold browser reload with no network is not guaranteed by the current website-only architecture because the browser may be unable to reload the application shell itself. This is a separate concern from preserving queued domain changes.

### M5.5 — Downloadable offline working area

Goal: after deliberate preparation, field users have downloaded local geographic context available to the already-loaded website during connectivity loss instead of relying only on the remote CARTO basemap.

Planned capabilities:
- Settings action to download an offline working area;
- initial/default target of approximately **3 km around the current map center**;
- downloaded map context stored durably in browser IndexedDB;
- saved Areas/Streets remain rendered and selectable above the offline map context;
- offline edits continue through the M5 durable mutation queue;
- update/delete controls for local map packages;
- clear download/storage/error state and required attribution;
- no Service Worker/PWA requirement.

The current CARTO raster basemap must not be cached/stored for this feature because CARTO Basemap terms prohibit storing/caching basemap content. Before implementation, select an offline-permitted OSM/OSM-derived source and package format through an explicit ADR.

Plan 011 is the implementation plan for this milestone. Prefer a map-data pipeline that can also support M6 Smart Street + House geometry rather than maintaining two unrelated datasets.

Important limitation: without a Service Worker or another later accepted app-shell strategy, a completely cold browser reload while offline may still show the browser's offline page before Verteil-Flyer JavaScript can run. Plan 011 must not falsely claim to solve that limitation unless the website-only architecture is explicitly revisited.

### M6 — Smart Street + House Tasks

Goal: stop using freehand street tracing as the normal workflow.

Planned capabilities:
- derive real road geometry from OpenStreetMap or another reviewed OSM-derived source;
- when an Area is created, offer/generate road segments that lie inside the Area;
- clip crossing roads to the Area where appropriate;
- tap/select an actual Street or Street segment instead of manually tracing a highlighter-like path;
- manual LineString drawing remains only as fallback for missing/special paths;
- House Mode for building-level distribution units;
- tap one building or select several buildings efficiently on mobile;
- Street progress may aggregate from child building Tasks where the data model supports it;
- geometry import must remain deterministic, reviewable and performant for whole-city datasets.

### M6.5 — Collection / pickup mode

Goal: reuse the same map and real road/building geometry for the later clothes-collection round instead of coordinating car routes through screenshots or memory.

Planned capabilities:
- explicit Campaign/operation mode for **Verteilen** vs **Einsammeln** rather than mixing both progress states;
- collection routes/road sections that can be marked open/completed while teams or parents drive them;
- reuse real Street and House geometry from M6 wherever possible;
- mark individual houses/addresses as pickup stops;
- add manually reported pickup addresses, for example when residents call the organization;
- pickup-stop states such as open/collected/not-found/not-collectable, exact vocabulary to be decided in the implementation slice;
- optional note/comment on a pickup stop;
- clear live overview of which collection roads and addresses are still open;
- mobile-first workflow suitable for use in a car by a passenger/coordinator, without requiring continuous GPS route recording.

Collection state must be separate from earlier flyer-distribution completion so finishing a flyer Street does not imply that the later pickup round is complete.

Before implementation, define the data model and authorization implications explicitly. Do not overload the existing `DistributionTask` status field with collection-only semantics without a reviewed model decision.

### M7 — Collaboration + Activity + Automations

Goal: make shared field work understandable without external chat screenshots and capture useful operational feedback at the moment it is still known.

Planned capabilities:
- comments on Campaign, Area and Task context;
- append-only activity events for meaningful changes;
- clear operational actor labels without requiring unnecessary personal data;
- useful automation/rule system;
- optional **distribution completion feedback** recorded directly by the group after working an Area/Street section:
  - duration spent distributing;
  - number of people in the group;
  - optional short note about difficulty/special circumstances;
  - attachment to an explicit Area/Task/session context rather than an unscoped statistic.

This feedback is intended to help coordinators answer questions such as whether an Area is realistically sized for a group and to avoid reconstructing crew size/duration from memory during later leader meetings.

Initial automation candidates:
- Area saved -> propose/generate road Tasks;
- all building Tasks for a Street complete -> optionally complete the parent Street;
- status mutation -> append activity event;
- completion feedback saved -> make it available to Area/Team reporting;
- progress threshold -> surface a coordinator indicator;
- stale/incomplete Areas -> optional reminders/attention indicators.

Automations must be deterministic and auditable. They must never silently perform a privileged mutation outside the caller/system authorization model.

### M8 — Organizations + Multi-Admin + Admin Panel

Goal: support multiple independent organizations and more than one administrator safely.

Planned concepts:
- Organization as top-level tenant/workspace;
- multiple Organization Admins;
- Campaigns belong to an Organization;
- organization-scoped member/access management;
- organization Admin panel separate from the lightweight field map;
- Campaign creation/archive/list management;
- role/access overview and revocation;
- organization settings;
- cross-Campaign operational overview for authorized admins only.

The current Campaign Admin access-link model is not assumed to be sufficient for this milestone. Organization identity/membership/session design requires an explicit architecture decision before implementation.

No organization may read or mutate another organization's data.

### M9 — Statistics + Reporting + UI themes

Goal: give coordinators useful progress and effort insight without building surveillance analytics.

Planned statistics:
- total/open/completed/later/not-deliverable Tasks;
- progress by Campaign, Team and Area;
- Street/building completion counts when House Mode exists;
- progress over time when event history exists;
- operational activity counts useful to coordinators;
- distribution duration by Area/Street/session where groups explicitly recorded it;
- group size per recorded distribution session;
- derived person-time (for example person-minutes/person-hours) where useful;
- historical comparison that helps identify Areas that are repeatedly too large/small or unusually difficult;
- collection-mode counts: open/completed road sections and pickup addresses once M6.5 exists.

Statistics should be derived from explicit product/domain records and events, not from continuous GPS tracking or inferred worker surveillance.

Planned UI appearance:
- personal `system` / `light` / `dark` UI preference;
- dark mode applies to website chrome, sheets, controls and Admin UI;
- basemap may remain the current light CARTO style initially;
- appearance is browser/user preference, not shared Campaign state unless later decided otherwise.

### M10 — Field hardening + release

Goal: real distribution and collection use at city scale.

Acceptance focus:
- representative Android and iPhone devices including older/slower hardware;
- dense city datasets;
- real outdoor connectivity loss/recovery;
- accessibility and touch ergonomics;
- organization/admin security boundaries;
- statistics correctness;
- collection-mode usability in realistic pickup rounds;
- operational deployment/recovery documentation.

## Cross-cutting requirements

### Whole-city performance

Design for significantly more than a small demo dataset. Synthetic acceptance should include at least 500 / 1,000 / 2,500 / 5,000 realistic Street features, with building-scale tests added when House Mode is implemented.

### Privacy

Do not add continuous GPS trails merely to power statistics, distribution effort reports or collection progress. Collect only data required by the product.

### Authorization

Every future organization, comment, completion-feedback, collection, automation, statistics or task endpoint must enforce scope server-side.

### Mobile first

Field flows remain one-handed and map-centric. Desktop/admin functionality can be denser, but must not degrade the mobile field interface.

### Website only

No native app, installable PWA, service worker or Background Sync unless a later accepted ADR explicitly changes the website-only decision.

Browser-local IndexedDB storage for deliberate map packages and mutation queues is allowed when it solves concrete field needs, but it does not by itself make the application shell cold-reloadable while offline.

## Not decided yet

The following require design/ADR work before implementation:
- offline map data source/provider and package format;
- offline package size/zoom/detail limits and refresh policy;
- whether a later proven requirement justifies offline app-shell loading and therefore revisiting ADR-0006;
- exact distribution completion-feedback entity/session semantics;
- exact collection/pickup task model and statuses;
- whether collection road completion aggregates from pickup-address completion;
- organization identity/login model;
- whether organization admins use account login, durable invitations, or another credential model;
- exact OSM road/building data provider and caching strategy;
- road splitting/merging semantics at intersections and Area boundaries;
- exact building multi-select gesture on mobile;
- automation rule storage/execution model;
- statistical retention/aggregation model.

Do not invent these decisions in implementation code before the corresponding slice begins.

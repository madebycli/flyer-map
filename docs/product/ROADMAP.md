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

Verteil-Flyer is evolving from a single-Campaign field map into a reusable distribution platform that can support multiple organizations, multiple administrators, better collaboration and trustworthy progress reporting.

The map remains the primary field workspace. Administrative and statistical capabilities should not turn the field view into a desktop-heavy dashboard.

## Planned milestones

### M5 — Resilient synchronization

Goal: important field changes survive unreliable connectivity and reloads.

Planned capabilities:
- durable browser mutation queue (IndexedDB preferred);
- idempotent server-side mutations;
- reconnect/visibility/manual retry;
- conflict states instead of silent last-write-wins;
- authorization/revocation-aware queue handling;
- current snapshot retained as fast startup/recovery cache.

No service worker or Background Sync API.

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

### M7 — Collaboration + Activity + Automations

Goal: make shared field work understandable without external chat screenshots.

Planned capabilities:
- comments on Campaign, Area and Task context;
- append-only activity events for meaningful changes;
- clear operational actor labels without requiring unnecessary personal data;
- useful automation/rule system.

Initial automation candidates:
- Area saved -> propose/generate road Tasks;
- all child building Tasks complete -> optionally complete Street segment;
- Task/Area status change -> create activity event;
- progress thresholds -> surface useful state to admins;
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

Goal: give coordinators useful progress insight without building surveillance analytics.

Planned statistics:
- total/open/completed/later/not-deliverable Tasks;
- progress by Campaign, Team and Area;
- Street/building completion counts when House Mode exists;
- progress over time when event history exists;
- operational activity counts useful to coordinators.

Statistics should be derived from product/domain events and state, not from continuous GPS tracking.

Planned UI appearance:
- personal `system` / `light` / `dark` UI preference;
- dark mode applies to website chrome, sheets, controls and Admin UI;
- basemap may remain the current light CARTO style initially;
- appearance is browser/user preference, not shared Campaign state unless later decided otherwise.

### M10 — Field hardening + release

Goal: real distribution use at city scale.

Acceptance focus:
- representative Android and iPhone devices including older/slower hardware;
- dense city datasets;
- real outdoor connectivity loss/recovery;
- accessibility and touch ergonomics;
- organization/admin security boundaries;
- statistics correctness;
- operational deployment/recovery documentation.

## Cross-cutting requirements

### Whole-city performance

Design for significantly more than a small demo dataset. Synthetic acceptance should include at least 500 / 1,000 / 2,500 / 5,000 realistic Street features, with building-scale tests added when House Mode is implemented.

### Privacy

Do not add continuous GPS trails merely to power statistics. Collect only data required by the product.

### Authorization

Every future organization, comment, automation, statistics or task endpoint must enforce scope server-side.

### Mobile first

Field flows remain one-handed and map-centric. Desktop/admin functionality can be denser, but must not degrade the mobile field interface.

### Website only

No native app, installable PWA, service worker or Background Sync unless a later accepted ADR explicitly changes the website-only decision.

## Not decided yet

The following require design/ADR work before implementation:
- organization identity/login model;
- whether organization admins use account login, durable invitations, or another credential model;
- exact OSM road/building data provider and caching strategy;
- road splitting/merging semantics at intersections and Area boundaries;
- exact building multi-select gesture on mobile;
- automation rule storage/execution model;
- statistical retention/aggregation model.

Do not invent these decisions in implementation code before the corresponding slice begins.

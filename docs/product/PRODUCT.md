---
id: product
type: product
status: accepted
last_updated: 2026-08-25
related: [product-roadmap, product-ux, architecture]
source_of_truth_for: [product-goals, product-concepts, user-groups]
---

# Product

## Problem

Flyer distribution is often coordinated with screenshots, hand-drawn markings and chat messages. This causes unclear current state, imprecise road coverage, duplicated work and constant switching between communication and map tools.

## Product promise

Verteil-Flyer provides one shared interactive map that quickly answers:

1. Where am I?
2. Which Area/Team is responsible here?
3. What still needs to be distributed?
4. What is already completed?
5. What changed recently and what needs attention?

For coordinators/organizations it should additionally answer:
- how far is the Campaign/Team/Area;
- who/what has administrative access;
- which Campaigns exist;
- where collaboration or automation needs attention.

## User groups

Current:
- field participants;
- Team coordinators;
- Campaign Admins;
- read-only viewers.

Planned:
- Organization Admins across multiple Campaigns;
- multiple administrators per Organization;
- coordinators using comments/activity/statistics/admin tooling.

Ordinary field participation should remain simple and should not require unnecessary personal identity data.

## Core concepts

Current concepts:
- **Campaign / Aktion** — one distribution effort/time period;
- **Team** — named group with display color;
- **Area / Gebiet** — geographic assignment;
- **Task** — a distribution unit; currently stored implementation uses Street Tasks;
- **Status** — open, completed, later, not-deliverable;
- **Access** — current Campaign-scoped Admin / Team Editor / Viewer permission;
- **Campaign map focus** — shared initial camera for new browsers;
- **Personal map view** — browser-local last center/zoom/bearing.

Planned concepts:
- **Organization** — top-level tenant/workspace containing Campaigns;
- **Organization Admin** — one of multiple authorized organization administrators;
- **Street/House Task** — map-data-backed road segment or building distribution unit;
- **Comment** — contextual collaboration attached to Campaign/Area/Task;
- **Activity/Event** — meaningful append-only shared change record;
- **Automation** — deterministic auditable domain rule;
- **Statistics** — progress/reporting derived from state/events, not continuous GPS tracking.

Exact future schemas/identity mechanics are not implied by these names; see `docs/product/ROADMAP.md` and proposed architecture nodes before implementation.

## Field interaction principles

- the map remains the primary workspace;
- saved Area selection is browse-like, not geometry-edit mode;
- polygon edit points appear only during explicit draw/edit;
- real road/building selection should replace freehand tracing as the normal future workflow;
- manual street tracing remains a fallback, not the long-term primary interaction;
- remote updates must not reset the current camera;
- unsaved active editing must not be silently destroyed;
- important local changes must eventually survive short connectivity loss via M5.

## Administration principles

- administrative capability is explicitly authorized, never inferred from knowing an id;
- multiple admins must be supported in the future;
- organization-wide admin surfaces stay separate from the lightweight field map;
- statistics/activity/access management belong in the Admin panel, not as permanent map clutter;
- cross-organization access is forbidden.

## Appearance

Application UI supports German and English. A personal `system` / `light` / `dark` UI appearance is planned; dark mode initially applies to website UI, not necessarily the basemap.

## Privacy

Device location is a local orientation aid. The baseline does not record continuous GPS trails or upload a movement history.

Statistics must not introduce hidden location tracking. Collect only data required for distribution state, collaboration, administration and explicitly accepted reporting.

## Long-term direction

Verteil-Flyer should be reusable across many Campaigns and Organizations while remaining fast enough for whole-city street/building workloads and simple enough for ordinary field users.

Detailed sequencing is the source of truth in `docs/product/ROADMAP.md`.

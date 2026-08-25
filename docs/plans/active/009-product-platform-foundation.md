---
id: plan-009-product-platform-foundation
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, architecture-offline-sync, architecture-organizations, architecture-collaboration, architecture-map]
---

# Plan 009 — Product Platform Foundation

## Goal

Continue from the accepted renderer/access baseline and evolve Verteil-Flyer into a reliable multi-Campaign distribution platform without losing the mobile-first map experience.

This plan is deliberately ordered. Do **not** start Organization/Admin/Statistics implementation before the synchronization/event foundations they depend on are understood.

## Baseline / source of truth

Before doing work from this plan, a fresh agent must read:
1. `AGENTS.md`;
2. `docs/status/CURRENT.md`;
3. `docs/context-map.yaml`;
4. `docs/product/ROADMAP.md`;
5. only the graph nodes relevant to the chosen slice;
6. accepted ADRs relevant to that slice;
7. current `main`, open PRs/issues and CI before editing code.

Current map baseline:
- MapLibre GL JS 5.7.1;
- CARTO Voyager Retina raster basemap;
- saved Areas/Streets in long-lived MapLibre GeoJSON sources/layers;
- active draw/edit only in SVG;
- no per-frame application projection loop for saved geometry.

Current access baseline:
- Campaign-scoped Admin / Team Editor / Viewer;
- server-side Worker authorization;
- revocable access grants/sessions;
- Campaign id is never a credential;
- operator Admin recovery uses the server-only configured recovery/bootstrap secret.

## Plan 008 closeout / known follow-ups

Plan 008 is completed with real-browser acceptance for saved Area/Street visibility + selection, map alignment during pan/zoom/rotate, active-only Area edit handles and mobile toolbar/safe-area behavior.

Known non-passed follow-ups remain visible:
- GitHub #22 — desktop bottom-toolbar fit/spacing;
- GitHub #23 — post-merge production health/deployed-origin Admin recovery smoke, real-browser `?diag=1`, and representative 500 / 1,000 / 2,500 / 5,000 Street browser/device stress validation.

Do not describe #22 or #23 as completed until their own acceptance is actually observed. They must be resolved no later than M10 field hardening/release and can be pulled forward earlier when convenient.

## Current execution state

PR #21 is merged. The repository coding environment still cannot independently resolve the public `workers.dev` hostname, so the production-health portion of #23 is not claimed passed.

On 2026-08-25 the user explicitly instructed development to continue. M5 therefore proceeds on an isolated branch/PR from the current post-PR21 `main`, while **merge/production rollout remains gated by normal CI, Cloudflare preview, D1 migration and browser acceptance**.

Active narrow M5 execution plan:
- `docs/plans/active/010-m5-resilient-mutation-sync.md`;
- PR #24 (`m5-resilient-sync-mainline`);
- ADR-0011.

The obsolete pre-PR21 M5 draft PR #17 is closed as superseded and must not be revived as the implementation branch.

## Work sequence

### Phase A — post-PR21 baseline

Completed repository state:
- PR #21 merged to current `main`;
- M5 branch created fresh from current `main`;
- Plan 010 + ADR-0011 created;
- old divergent PR #17 closed as superseded.

Still tracked outside the M5 implementation branch:
- public production-health verification in #23 when an environment with `workers.dev` access is available.

This unresolved network verification does not authorize skipping M5 release gates; it only means implementation can continue without pretending the external check passed.

### Phase B — M5 resilient mutations

Implement the durable synchronization foundation through Plan 010.

Tasks:
- IndexedDB-backed mutation queue;
- stable mutation/idempotency ids;
- explicit mutation types instead of arbitrary full-snapshot replacement where practical;
- Worker idempotency persistence;
- ordered retry with backoff;
- retry on online / visibility / reload / manual refresh;
- conflict classification;
- stop blind retries after authorization is revoked;
- keep snapshot cache as startup/recovery state;
- additive D1 migration only.

Acceptance:
- saved offline mutation survives reload;
- duplicate retry applies once;
- Viewer cannot enqueue/apply privileged server mutations;
- Team Editor scope stays server-enforced;
- conflict is visible, never silently overwritten.

### Phase C — M6 Smart Street + House Tasks

Replace manual tracing as the normal street workflow.

Research first:
- reviewed OSM/OSM-derived road + building source;
- usage/caching/licensing constraints;
- road identity and segment splitting rules;
- performance for whole-city geometry.

Implementation direction:
- Area save can fetch/propose road geometry inside the polygon;
- roads crossing Area boundary can be clipped/split according to accepted rules;
- user taps real Street/segment rather than tracing it;
- manual tracing remains fallback;
- House Mode supports selecting one/multiple buildings on mobile;
- task hierarchy/progress rules documented before schema change.

Acceptance:
- generated line follows real road geometry;
- no diagonal/highlighter approximation through buildings;
- mobile selection remains map-pan friendly;
- dense data remains performant.

### Phase D — M7 comments, activity, automations

Prerequisite: durable mutation/event semantics from M5.

Tasks:
- comments scoped to Campaign/Area/Task;
- append-only meaningful activity events;
- actor/access label strategy without unnecessary personal data;
- first deterministic automation rules;
- idempotent automation execution;
- visible automation failures.

Acceptance:
- comments respect authorization scope;
- activity reflects real domain changes;
- automations cannot bypass Worker authorization;
- duplicate event delivery does not duplicate effects.

### Phase E — M8 Organizations + Admin panel

Do not implement until an ADR defines identity/membership.

Tasks:
- Organization top-level tenant model;
- migration path for existing Campaigns;
- multiple Organization Admins;
- Organization/Campaign membership/role matrix;
- Worker/D1 tenant scoping;
- Admin panel for Campaign/access/settings/activity management;
- organization-safe recovery/revocation.

Acceptance:
- two organizations cannot read/mutate each other;
- more than one Admin can manage one organization;
- legacy Campaigns migrate without first-visitor claim race;
- field map remains lightweight and separate from admin workflows.

### Phase F — M9 Statistics + UI appearance

Statistics:
- totals by Task status;
- completion percentage by Campaign/Team/Area;
- Street/House progress when available;
- progress-over-time from event history;
- organization overview for authorized admins.

Appearance:
- personal `system` / `light` / `dark` setting;
- dark website chrome/admin UI;
- keep current basemap unchanged initially;
- accessible contrast in both themes.

Acceptance:
- numbers reconcile with source state/events;
- statistics never require continuous GPS tracking;
- dark mode does not alter shared Campaign state;
- map remains usable and visually clear.

### Phase G — M10 field hardening/release

- resolve any still-open #22 desktop toolbar follow-up;
- resolve #23 operational renderer/recovery validation if not already closed;
- real Android/iPhone tests including slower devices;
- 500 / 1,000 / 2,500 / 5,000 Street tests;
- building-scale load tests;
- outdoor connectivity failure/recovery;
- accessibility pass;
- admin/organization security review;
- production runbook and recovery verification.

## Explicit non-goals

Unless a new accepted ADR changes them:
- no native app;
- no PWA install flow;
- no service worker;
- no Background Sync API;
- no continuous GPS history for statistics;
- no silent automation with unclear trigger/effect;
- no cross-organization admin access;
- no return to freehand street tracing as the primary workflow.

## Documentation rules

For every phase:
- update relevant context graph nodes;
- create ADR for expensive architectural decisions;
- create additive D1 migrations;
- update `CURRENT.md` with only current state/next work;
- move completed phase plan material to completed/history rather than leaving stale active instructions.

## Immediate next action for a fresh agent

If PR #24 is open, continue Plan 010 first: inspect its exact current head/CI, preserve the MapLibre 5.7.1 renderer, and finish M5 repository + runtime acceptance. Do not restart old PR #17. Only after M5 is merged/deployed should Phase C / M6 begin.

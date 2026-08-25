---
id: plan-008-renderer-access-recovery
type: plan
status: completed
last_updated: 2026-08-25
related: [architecture-map, architecture-security, quality, operations-deployment, operations-production]
---

# 008 — Access recovery + whole-city renderer

## Goal

Restore Admin access for existing Campaigns without weakening Worker authorization and establish a whole-city renderer that keeps saved geometry locked to the basemap without application-side per-frame projection.

## Delivered baseline

- M4 access links remain Worker-authorized; Campaign id is a selector, never a credential.
- Admin recovery is available through same-origin `POST /api/admin/recover`, guarded by server-only `M4_BOOTSTRAP_SECRET`.
- Recovery creates a normal revocable Admin grant/session and does not persist the recovery secret or plaintext access credentials.
- MapLibre GL JS is pinned to **5.7.1**.
- Saved Areas/Streets live in persistent MapLibre GeoJSON sources/layers included in the initial style.
- Later Campaign changes update existing sources through `setData()`.
- Saved selection uses rendered-feature queries.
- Normal browse pan/zoom/rotate performs no application-side saved-geometry `map.project()` loop.
- Active Area draw/edit and Street draw remain SVG-only; stored edit points are hidden in browse.
- `?diag=1` exposes opt-in renderer/performance diagnostics while redacting token-like values and removing Campaign selector/hash from copied URLs.

## Repository-controlled acceptance

For the runtime baseline at `3232e9e180fb3e2706278157e6fabccf0c4efeac` and the documentation-only acceptance heads after it:
- source review confirmed the accepted MapLibre source/layer lifecycle and 5.7.1 pin;
- access tests cover correct/wrong operator-secret matching and fresh Admin recovery grant/session creation without plaintext token persistence;
- diagnostics implementation reports renderer kind, source/rendered counts, FPS/long frames and related browser hints;
- CI remained green through documentation head `0008cf90cc2cc98590d7b6ef549e344339104be3` (CI #174);
- Cloudflare deployed the exact documentation head successfully as a commit/branch preview.

The closeout changes after the runtime baseline are documentation-only, so accepted runtime behavior remains applicable.

## Real-browser acceptance completed

User testing against the Cloudflare preview confirmed:
- saved Area remains visible and selectable after Save;
- saved Street remains visible and selectable after Save;
- pan/zoom/rotate behavior is acceptable and saved geometry remains visually aligned with the map;
- Area edit handles are visible only while active, remain usable during editing and disappear again after leaving the edit flow;
- mobile bottom field toolbar positioning and mobile safe-area behavior are acceptable.

This satisfies the real-browser renderer/edit/mobile acceptance required for the current mobile-first baseline.

## Explicitly deferred follow-ups

The following checks are **not** claimed as passed and are intentionally tracked outside this completed slice:

- **#22 — Desktop bottom toolbar fit and spacing.** Desktop/PC layout was reported as not satisfactory and explicitly deferred for later. Mobile acceptance remains valid.
- **#23 — Post-merge renderer/recovery operational validation.** A repository-only coding session has no interactive browser runner and no access to the server-only recovery secret. The issue therefore tracks deployed-origin Admin recovery smoke, `?diag=1` real-browser output, and representative 500 / 1,000 / 2,500 / 5,000 Street browser/device stress runs.

These follow-ups remain visible risk/quality work; completing Plan 008 does not convert them into passed tests.

## Closeout decision

Plan 008 is complete because the implementation goal and the required real-browser map/edit/mobile baseline were delivered and accepted. External checks that could not be executed here are explicitly preserved as GitHub follow-ups rather than silently waived.

Before merging PR #21, the final closeout-documentation head must still receive normal green CI and an exact successful Cloudflare preview. After merge, verify production deployment/health and then continue with Plan 009 / M5 from fresh `main`.

## Runtime version rule

Do not upgrade MapLibre from 5.7.1 inside unrelated work. A future upgrade needs dedicated browser acceptance proving saved GeoJSON visibility, hit testing and performance.

## Decision

Use the GL source/layer lifecycle for persistent saved geometry and SVG only for active input. Do not return to full saved SVG/Canvas rendering as the default whole-city architecture.

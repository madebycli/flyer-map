---
id: plan-009-product-platform-foundation
type: plan
status: active
last_updated: 2026-08-25
related: [product-roadmap, architecture-offline-sync, architecture-organizations, architecture-collaboration, architecture-map, plan-012-platform-app-expansion]
---

# Plan 009 — Product Platform Foundation

## Purpose

This plan records the dependency order from the accepted renderer/access baseline into the larger product platform.

The detailed current expansion target is now `docs/plans/active/012-platform-app-expansion.md`.

Do not use this older foundation plan to restart work that already has a branch/PR.

## Current baseline

- PR #21 / M4 renderer + access recovery is merged on `main`;
- MapLibre 5.7.1 remains the accepted renderer baseline;
- current Campaign access is Admin / Team Editor / Viewer with Worker-side authorization;
- website-only baseline remains: no native app/PWA/Service Worker/Background Sync.

## M5 is already active

M5 resilient synchronization was started after this plan was originally written.

Current implementation is Draft PR #24 on branch `m5-resilient-sync-mainline`.

Do **not** create another M5 branch.

Before touching M5:
- inspect PR #24;
- inspect its current branch docs/tests/CI;
- finish remaining gates on that implementation.

## Foundation sequence

### A — M5 durable synchronization
Required before live collaboration and complex shared workflows:
- durable browser mutation queue;
- idempotent Worker/D1 mutation processing;
- visible conflict/auth/retry states;
- server-side authorization preserved.

### B — M5.5 prepared offline map data
See Plan 011.

Select an offline-permitted map-data source/format and prepare approximately 3 km working areas while preserving the no-Service-Worker boundary.

### C — M6 Smart Street + House geometry
Establish stable real Street/House geometry and identities.

This is a prerequisite for reliable:
- House Mode;
- session map highlighting;
- collection/pickup;
- detailed progress statistics.

### D — M6.5 Collection / Pickup
Keep flyer Distribution and clothes Collection as separate domain states while reusing Street/House geometry.

### E — M7 Sessions + Live Groups + Collaboration
Build on M5 event/mutation semantics:
- Field Sessions;
- duration/participant feedback;
- live multi-device Field Groups;
- QR/code/password joins;
- comments/activity/automations;
- initial progress.

### F — M8 Organizations + Identity + Permissions + Admin
Requires accepted ADRs before account/security implementation:
- username/password/TOTP admin accounts;
- multiple admins / safe transfer;
- tenant isolation;
- configurable capabilities;
- Team archive/delete;
- desktop Admin panel.

### G — M9 Statistics + App Shell + Support
- Campaign/Team/Area progress;
- session/person-time statistics;
- app-like mobile navigation;
- Support/Feedback;
- appearance.

### H — M10 Hardening
- security tests/review;
- tenant isolation;
- injection/XSS/CSRF/session/TOTP;
- join-code abuse resistance;
- dense map/session data;
- real mobile/desktop acceptance.

## Known follow-ups

Keep existing renderer/operations follow-ups visible:
- GitHub #22 desktop bottom-toolbar fit/spacing;
- GitHub #23 production health/recovery/diagnostics and dense Street validation.

## Source of truth for full expansion

Use:
- `docs/product/ROADMAP.md`;
- `docs/plans/active/012-platform-app-expansion.md`;
- `docs/context-map.yaml`;
- the architecture nodes selected by the graph.

For a fresh implementation chat use:
- `docs/prompts/START_PLATFORM_EXPANSION.md`.

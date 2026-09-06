---
id: quality
type: quality
status: accepted
last_updated: 2026-08-29
related: [architecture, architecture-map, product-ux, product-roadmap]
source_of_truth_for: [quality-gates, performance-acceptance, target-devices]
---

# Quality Baseline

## Target devices

Primary:
- current Chromium-based Android browsers on ordinary phones;
- current Safari on supported iPhones.

Performance/hardening target:
- remain usable on materially slower/older hardware where practical;
- iPhone 8-class performance is a useful stress target even when browser/OS support limits exact production coverage;
- low-core Android devices must be represented in diagnostics/load testing.

Do not declare map performance based only on a fast desktop or flagship phone.

## Required automated checks

Every PR should at minimum pass the repository `check` flow (tests + TypeScript + production build where configured).

Add tests around domain/security/sync logic. Browser-visible map correctness still requires browser acceptance because CI cannot prove that GeoJSON is actually visible/hit-testable on a device.

## Field/browser testing

Explicitly test:
- saved Area visible + selectable;
- saved Street visible + selectable;
- prepared OSM Street candidates visible, snappable and selectable in the normal Area flow;
- explicit resolution of candidate and route ambiguity;
- pan/zoom/rotate alignment;
- active edit handles only while editing/drawing;
- geolocation allowed/denied;
- Android and iPhone browser behavior;
- intermittent network and reconnect;
- two or more authorized devices editing shared state;
- accidental status action + undo;
- tab resume/background behavior;
- Admin/access recovery where applicable;
- desktop bottom-toolbar fit and mobile safe areas;
- light/dark UI once implemented.

## Whole-city map performance

Saved geometry must not cause application-side per-frame work proportional to every Street/Area during ordinary browse camera movement.

Synthetic/representative acceptance targets:
- 500 Streets;
- 1,000 Streets;
- 2,500 Streets;
- 5,000 Streets.

The current House renderer slice adds batched conversion checks at 1,000 / 2,500 / 5,000 / 10,000 / 20,000 House features. House Mode still requires real-device building-density acceptance for a 40k-60k resident city-scale Campaign before a final scale claim.

Measure:
- FPS / long frames;
- interaction latency;
- memory/DOM growth;
- initial/updated GeoJSON processing time;
- saved-feature hit testing;
- basemap request behavior.

## Map runtime upgrades

MapLibre is currently pinned to 5.7.1 after 6.4.1 caused a real-browser saved-GeoJSON regression.

A map-runtime upgrade must pass a dedicated browser test with real saved Area + Street data and cannot rely only on compilation/unit tests.

## Application performance principles

- no external web fonts;
- no marketing imagery/video;
- no unnecessary telemetry SDK;
- avoid unnecessary startup requests;
- keep field UI smaller/simpler than map/runtime workload;
- investigate every substantial dependency;
- statistics should use product data, not a third-party tracking SDK by default.

## Accessibility

- keyboard/focus semantics where applicable;
- touch targets suitable for field use;
- critical state not color-only;
- accessible contrast in future light/dark themes;
- admin/statistics UI must remain readable and keyboard navigable on desktop.


### Plan 031 mobile Field acceptance

Plan 031 acceptance requires structure tests for the flat seven-destination launcher, dedicated Room/progress/comment/Street hubs, shared draggable-sheet behavior and Street close-to-map semantics. Mobile browser acceptance covers at least a 390x844-class viewport plus a narrower viewport, handle dragging across snap heights, normal body scroll without snap changes, close at every snap, long comment threads with reachable composer and keyboard-aware `visualViewport` handling. Brainrot long-press remains a regression gate on `.platform-grid-button`.

Room acceptance covers visible and hidden creation, manager visibility of hidden Rooms, Code and QR join in both states, repeated reveal of identical current credentials without rotation, rotation invalidating only future join material, membership preservation across rotation/revoke, and fail-closed reveal after revoke/close/expiry. Tests and diagnostics must not log plaintext Room Code, QR token, session material or encryption keys.

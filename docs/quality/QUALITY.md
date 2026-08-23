---
id: quality
type: quality
status: accepted
last_updated: 2026-08-24
related: [architecture, product-ux]
---

# Quality Baseline

## Target devices

Primary support:
- current Chromium-based Android browsers on ordinary devices such as Pixel 6-class hardware and newer
- current Safari on iPhone 11-class hardware and newer

Older still-common devices are best-effort unless field testing shows they need explicit support.

## Required checks

Every pull request should at minimum pass:

```bash
npm run typecheck
npm run build
```

Add automated tests when domain logic/user flows appear. Do not add a test framework merely to create empty tests.

## Field testing

Before MVP release explicitly test:
- map pan/zoom/tap interaction
- crisp street/building rendering on a high-DPI phone
- geolocation allowed/denied
- normal mobile-browser use on Android
- normal mobile-browser use on iPhone
- intermittent network
- two or more devices editing the same campaign
- accidental action + undo
- browser tab resume after backgrounding

## Performance budget

Principles:
- no external web fonts
- no marketing imagery/video
- no analytics SDK in MVP
- avoid unnecessary startup requests
- only load current campaign/area data
- MapLibre is the expected major client dependency; keep unrelated website code small

Initial target: keep non-map application code comfortably below the map bundle and investigate any new dependency that materially changes initial transfer size.

## Accessibility

Keyboard/focus semantics still matter even though mobile touch is primary. Critical state cannot rely on color alone.

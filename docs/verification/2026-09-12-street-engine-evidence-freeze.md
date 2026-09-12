# StreetEngine evidence freeze, 2026-09-12

- Source: madebycli/flyer-map, fix/street-engine-smart-marking.
- Frozen HEAD: b126e70899ad5a5c206d8c3ed0fa1fe7b34766fe.
- Draft PR #92, open/unmerged, base integration/main-street-runtime@f4facd6ef354c5ba6de861519b696bce6f46a209.
- main: ebc082bcaa1062215ca63a8f2c99a667418f5975 (context pointer; separate product baseline).
- Route read from main:.ai/CONTEXT.md; exact flyer-map mapping validated against master-context REGISTRY.yaml. Active branch lacks pointer because it predates the main route commit.
- Mandatory flyer-map Primary Nodes read; current context claims lag the source HEAD.
- GitHub Actions CI 34716462762: completed/success for frozen HEAD. Detailed steps/test totals to verify separately.
- Existing implementation commits: 987ed4a06b5e8b23d6fc6cc502c72868fca44a0d (Area HUD/building recovery); 8b1bec21a0fbe0e4ca26c297cb61169df79dde3b (prepared Area deletion snapshot bound).
- Audit order: verify D1 deletion gate; reproduce Buildings error classes; trace generation/publish/sync; compare four compute models; persist implementation plan; only then bounded evidence-backed fixes.
- Initial D1_STATUS=UNVERIFIED; STREET_ENGINE_LIVE_READY=FALSE; D1_ATTRIBUTION_CONFIRMED=FALSE; MAP_RENDER_P0=OPEN.
- No new remote D1/Overpass load, migration, deploy, merge or secret change. 20,000 Houses is a synthetic planning target, not established live capacity.

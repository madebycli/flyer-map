# StreetEngine polygon/copy checkpoint

Date: 2026-09-16
Base beta: `37214a8b1afdb17f0cb6846318bd40c520a3fe82`
Branch: `fix/street-engine-polygons-copy-filter-plan-2026-09-16`

## User evidence

A real Gebiet 4 beta run completed `ready` with approximately 59.2 seconds server time, 1,551 street outputs, 8,595 building objects received, 8,582 accepted, 13 rejected as `invalid_polygon`, 5,935 addressable targets and 5,015 house tasks. The run used 26 source-cache hits and showed no provider attempts in the supplied diagnostic screenshots, so this is not evidence for a cold-source 59-second run.

## Changes in this branch

- diagnostic copy no longer waits for a server fetch before invoking browser copy;
- synchronous selection copy is attempted inside the user click before any await, with Clipboard API and manual selectable text fallback;
- malformed closed building rings get a conservative repair path before `invalid_polygon` rejection;
- repair only accepts one valid, hole-free polygon that remains inside source bounds;
- valid polygons stay unchanged;
- irreparable geometry is still rejected rather than silently corrupted;
- Plan 038 defines delivery-relevance filtering and explicitly separates connectivity from visible distribution streets;
- road/POI filter behavior is intentionally unchanged in this slice.

## Remaining proof

- branch CI and independent scale audit;
- beta release after green merge;
- physical iPad copy verification requires the user/device;
- a fresh real Gebiet 4 preparation is needed to measure how many of the 13 malformed source buildings are safely recoverable;
- delivery-relevance behavior remains a planned shadow-classification task, not released filtering.

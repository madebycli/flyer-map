# Plan 039 — Smart Marking shortest-path + Beta Screening Toggle

Status: ACTIVE
Date: 2026-09-16
Target: beta only
Base beta: `b1c5ccca756bfa963cf1e76d16d8a2beacef4384`
Feature branch: `feat/smart-marking-v2-filter-toggle-2026-09-16`

## Goal

Make Smart Marking behave deterministically in the field and make the new StreetEngine delivery screening reversible after preparation has completed.

## Smart Marking contract

1. Every successful tap becomes a visible anchor point on the map.
2. Intersections are valid anchors. If several prepared road fragments are under the tap, choose the candidate that produces the shortest reachable leg from the previous anchor.
3. For every leg, use the shortest network route only. Do not ask the distributor to choose among route alternatives.
4. A failed tap is transactional. If there is no prepared road or no reachable path, do not append the point and do not damage the existing preview.
5. Failure feedback is explicit: `Keine Straße gefunden. Punkt wurde zurückgesetzt.` or `Kein Weg gefunden. Punkt wurde zurückgesetzt.` The next tap can be attempted immediately without Undo.
6. Existing accepted anchors and prior route geometry remain unchanged after a failed tap.
7. Routing remains on the canonical prepared graph and keeps the existing route/range budgets and server replay validation.
8. Accepted road fragments are highlighted in addition to the existing start/waypoint/end point layers.

## Beta Screening toggle

The StreetEngine generation remains canonical and unchanged. Screening is a post-generation distribution view and can be switched at any time:

- **Filter V1 · Klassisch**: show the current prepared StreetEngine output unchanged.
- **Screening V2 · Beta**: conservative post-generation screening.

The first V2 slice uses only metadata that already exists in a finished generation, so it works without regenerating the area. It hides only auto-prepared generic unnamed street fragments with zero assigned House tasks. It keeps:

- every street with one or more assigned Houses;
- every named/referenced street;
- every manual/legacy street;
- all Houses unchanged;
- the full canonical graph for Smart Marking and routing, including hidden connectors.

This is intentionally narrower than the final Plan 038 classifier because existing prepared tasks do not persist all OSM `highway/service/access` tags needed for a reliable garden/field/commercial classifier. The toggle is therefore safe to compare now while Plan 038 can later enrich future generations with reasoned OSM semantics.

## Implementation

- `src/domain/streetScreening.ts`: deterministic reversible V1/V2 view.
- `src/map/useNetworkWorkspace.tsx`: shortest-only waypoint routing, intersection candidate scoring, failed-tap rollback, visible anchor/highlight data, persisted beta screening mode and toggle UI.
- `tests/streetScreening.test.ts`: screening invariants.
- `tests/smartMarkingHook.test.ts`: intersection, shortest route, visible anchor, failed-tap rollback and no-Undo regression coverage.

## Acceptance gates

- crossing tap appends exactly one visible anchor when at least one reachable fragment exists;
- multiple route alternatives select the shortest route automatically;
- no-route tap leaves point count and existing preview unchanged;
- every accepted point appears in the smart point anchors;
- V1 restores exactly the unfiltered prepared task set;
- V2 never hides a street serving an assigned House;
- switching V1/V2 does not rerun StreetEngine and does not mutate canonical generation data;
- branch CI, typecheck, dependency audit, production build and independent StreetEngine scale audit pass;
- merge only to `beta`, then normal Beta release/smoke only;
- stable/main untouched.

## Non-goals

- no stable release;
- no destructive filtering of canonical StreetEngine data;
- no automatic exclusion of commercial buildings in this slice;
- no claim that the conservative V2 view fully implements all OSM-semantic classes from Plan 038.

# Plan 041 — Smart Marking precision + visible vertices

Status: ACTIVE
Date: 2026-09-16
Target channel: beta only
Base beta: `5f0bb69a9330ff7c3f195151256c921d304daa67`

## Regression

After removing the duplicated Smart candidate-road GeoJSON overlay, Smart Marking lost the rendered-road hit information that previously constrained a tap to the street actually under the pointer. The routing index still saw every road in a large meter radius and shortest-route selection could therefore pull a tap toward a nearby edge/intersection or another road. Side streets became difficult to select precisely.

The Smart point source still existed, but the visual treatment did not match the manual drawing vertices requested for field use.

## Implementation

1. Keep the full prepared network out of the Smart overlay for performance.
2. In Smart Street mode, hit-test the exact pointer against already-rendered normal street layers first; only if there is no exact hit, use the touch-sized fallback box and pass its `taskId`s to Smart Marking.
3. Use the RoadIndex only for exact geometric snapping and routing.
4. If rendered hit ids are unavailable, use a bounded 20 m spatial fallback instead of the old broad 45 m choice space.
5. In every case, only candidates within 0.5 m of the nearest spatial candidate may compete on route length. This keeps true crossing ties routable while making pointer position dominant everywhere else. Hidden Screening-V2 tasks are not eligible as fallback tap targets.
6. Render all accepted Smart points as purple circles (`#7c3aed`) with radius 9 and a white 3.5 px outline, exactly matching the normal manual area/street vertex geometry. Hide text labels.
7. Keep the existing Smart preview/marking line styling unchanged.

## Acceptance gates

- A tap in the middle of a street snaps to that point on the segment, not to an endpoint.
- Side-street taps prefer the visibly hit side street.
- At a true crossing, near-equal candidates can still be resolved by shortest reachable route.
- A candidate more than 0.5 m farther than the nearest tap candidate cannot win only because it gives a shorter route.
- An exact rendered-line hit wins before the wider touch fallback is considered.
- Screening-hidden streets cannot become invisible fallback tap targets.
- First, intermediate and final accepted points are visibly purple with white outline.
- No text labels are shown for Smart points.
- Existing Smart preview line remains unchanged.
- Full prepared road network is not reintroduced into the Smart candidate GeoJSON overlay.
- CI, typecheck, production build and independent StreetEngine audit must pass before merge to beta.
- Release only through the normal beta workflow/link. Stable/main untouched.

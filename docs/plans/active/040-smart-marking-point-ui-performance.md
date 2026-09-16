# Plan 040 — Smart Marking point UI, map performance and immediate commit close

Status: ACTIVE
Date: 2026-09-16
Target channel: beta only

## Problems confirmed from device feedback

1. A Smart Marking tap currently highlights the whole selected StreetEngine fragment. The desired interaction is a visible point marker at the exact accepted tap, matching the manual street-edit vertex interaction.
2. Smart Marking currently sends the complete prepared road network into a second MapLibre GeoJSON source while the same roads are already present in the normal street source. On large prepared areas this duplicates thousands of line features and causes avoidable map work.
3. `commit()` waits for the remote network-intent flush and refresh before returning. After that wait it resets points but leaves `marking=true`, so the sheet stays open until the user presses X.

## Implementation

- Keep StreetEngine routing data in the in-memory `RoadIndex`, but do not mirror the full candidate network into the Smart overlay.
- Resolve Smart taps spatially through `RoadIndex` even when no Smart candidate line feature is rendered.
- Keep only accepted point anchors and the actual between-point route preview in Smart MapLibre overlays.
- Do not highlight entire source road fragments merely because a point was set.
- Preserve shortest-path/crossing behavior from Plan 039.
- Persist the network intent locally first. As soon as local persistence succeeds, close Smart Marking and update optimistic state.
- Run online flush/refresh in the background. A remote delay must not hold the interaction sheet open.
- If local persistence itself fails, keep the sheet open and show an error.

## Acceptance gates

- First accepted tap shows a point marker and no selected-road overlay.
- Two or more accepted taps may show only the actual route preview between those points, plus point markers.
- Smart mode does not populate the duplicate Smart candidate-road source with all prepared roads.
- Crossing and shortest-route tests remain green.
- `✓ -> Erledigt` closes the Smart Marking sheet immediately after local enqueue, without waiting for the remote request.
- Offline commit also closes immediately and stays queued.
- Failed local enqueue keeps the sheet open.
- CI, typecheck, production build and independent StreetEngine audit must pass before beta merge.
- Release only through the normal beta branch and normal beta URL. Stable/main untouched.

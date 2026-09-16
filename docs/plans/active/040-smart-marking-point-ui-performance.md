# Plan 040 — Smart Marking point UI, map performance and immediate shortcut reset

Status: ACTIVE
Date: 2026-09-16
Target channel: beta only

## Problems confirmed from device feedback

1. A Smart Marking tap currently highlights the whole selected StreetEngine fragment. The desired interaction is a visible point marker at the exact accepted tap, matching the manual street-edit vertex interaction.
2. Smart Marking currently sends the complete prepared road network into a second MapLibre GeoJSON source while the same roads are already present in the normal street source. On large prepared areas this duplicates thousands of line features and causes avoidable map work.
3. A shortcut status action such as `Erledigt` waits for the remote network-intent flush and refresh before the loading state clears. The distributor wants to remain in Smart Marking and immediately continue with the next selection.

## Implementation

- Keep StreetEngine routing data in the in-memory `RoadIndex`, but do not mirror the full candidate network into the Smart overlay.
- Resolve Smart taps spatially through `RoadIndex` even when no Smart candidate line feature is rendered.
- Keep accepted point anchors and only the actual between-point route preview in Smart MapLibre overlays.
- Do not highlight entire source road fragments merely because a point was set.
- Preserve shortest-path/crossing behavior from Plan 039.
- Persist the network intent locally first.
- As soon as local persistence succeeds, clear the current point/route selection and stop the loading state, but keep Smart Marking itself open.
- Clear the area lock after the shortcut so the next tap can start a fresh Smart selection normally.
- Run online flush/refresh in the background. Remote latency must not hold the shortcut loading state open.
- If local persistence itself fails, keep the current selection and show an error.

## Performance evidence from device diagnostics

- Reported renderer sample: 144 FPS, worst frame 7.1 ms, no >32 ms frames during the captured window.
- Reported JS heap: about 293 MB.
- The diagnostic page also produced many `/preparation?diag=1` requests taking roughly 1–5 seconds each, so diagnostic-mode network activity must not be mistaken for pure renderer cost.
- Independent of that diagnostic overhead, duplicating the prepared road network into the Smart overlay is unnecessary and is removed by this plan.

## Acceptance gates

- First accepted tap shows a point marker and no selected-road overlay.
- Two or more accepted taps show the actual route preview between those points plus point markers.
- Smart mode does not populate the duplicate Smart candidate-road source with all prepared roads.
- Crossing and shortest-route tests remain green.
- `✓ -> Erledigt` clears the current Smart selection and loading state after local enqueue without waiting for the remote request.
- Smart Marking remains open for the next selection.
- Offline shortcut commit behaves the same and stays queued.
- Failed local enqueue keeps the current selection available for retry.
- CI, typecheck, production build and independent StreetEngine audit must pass before beta merge.
- Release only through the normal beta branch and normal beta URL. Stable/main untouched.

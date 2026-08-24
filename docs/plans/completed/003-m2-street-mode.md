# Plan 003 — M2 Street Mode

Status: completed for milestone implementation on 2026-08-24.

## Goal

Add manually traced street tasks, field status changes and immediate Undo on top of team areas.

## Completed outcome

- snapshot schema v2 with street tasks
- manual LineString street tracing assigned to an area
- statuses `open`, `completed`, `later`, `not-deliverable`
- `completedAt` behavior and immediate Undo
- local persistence across reloads
- street rename/delete and area-delete cascade
- production rendering ultimately provided by the independent SVG overlay
- the confirmed production-phone check now shows street draft geometry and saved street lines correctly

## Verification boundary

The production-phone stability check closes the M2 milestone dependency for M3: street geometry and the application overlay are visibly functional on the real device.

This does **not** claim completion of the final Android + iPhone/Safari release matrix. Broader cross-device hardening remains an M6 task.

## Decisions retained

- manual street tracing remains the M2/M3 task source
- status changes are optimistic and explicit
- no OSM street import, House Mode, GPS routes, service worker or PWA behavior
- durable multi-mutation offline queuing remains a later synchronization milestone

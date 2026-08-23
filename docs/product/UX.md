---
id: product-ux
type: product
status: accepted
last_updated: 2026-08-24
related: [product, architecture-map]
---

# UX Rules

## Mobile first

Design for one-handed outdoor use before desktop use.

- primary actions need large touch targets
- important information must remain readable in sunlight
- avoid hover-only interaction
- respect safe-area insets
- map panning must not accidentally complete tasks
- completion actions must have an immediate undo path

## Visual hierarchy

The map is the primary workspace. Toolbars and status cards should float above it without consuming most of the viewport.

## Color

Team colors identify ownership/assignment. Completion state must not depend on color alone.

Use a second visual channel such as line style, fill pattern, icon or checkmark.

## Task states

Initial vocabulary:
- open
- completed
- later
- not-deliverable

## Performance UX

Prefer immediate optimistic feedback for safe status changes, followed by background synchronization.

Never hide synchronization failure. A pending/offline state must be visible when unsent changes exist.

## Accessibility

- semantic controls
- visible focus state
- sufficient contrast
- labels for icon-only buttons
- no critical state communicated only through color
- respect reduced-motion preferences if motion is later introduced

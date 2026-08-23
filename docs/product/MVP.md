---
id: product-mvp
type: product
status: accepted
last_updated: 2026-08-24
related: [product, architecture]
---

# MVP

## Release goal

A reliable field-ready version that can be used for a real flyer distribution campaign on common Android phones and iPhones.

## Must have

- mobile-first map interface
- installable/useful as a PWA
- current device location on demand
- campaigns
- named/color-coded teams
- assigned map areas
- manual task completion
- clear progress state
- shared state across multiple devices
- basic authorization via invite/access links
- short connectivity loss must not silently lose work
- undo for accidental status changes

## Not required for MVP

- native app stores
- continuous GPS route history
- automatic completion based on movement
- advanced analytics
- email/password accounts
- complex organization management
- decorative motion effects

## Milestones

- M0 Repository foundation
- M1 Campaign/team/area model
- M2 Distribution task interaction
- M3 Shared persistence with D1
- M4 Access links and authorization
- M5 Offline mutation queue and synchronization
- M6 Field testing and hardening
- M7 MVP release

## Release gate

The MVP is not ready until the same campaign can be used safely on at least one representative Android phone and one representative iPhone under realistic outdoor connectivity conditions.

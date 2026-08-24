# Plan 004 — Mobile Map Stability and Field UI

Status: completed/superseded by the final SVG stability solution on 2026-08-24.

## Goal

Address the production-phone failures found after M1/M2 while keeping the field UI compact and geolocation local-only.

## Completed outcome retained

- one-shot geolocation focus instead of persistent camera tracking
- compact mobile field UI
- primary + backup localStorage snapshots
- removal of the long-lived centered map-loading gate
- simplified application hit areas and map interaction behavior

The MapLibre application-layer repairs in this plan did not by themselves solve the production-phone geometry failure. That rendering problem was resolved by Plan 005's independent SVG application overlay.

## Verification boundary

The combined stability outcome is now accepted on the production phone: areas, streets, draft geometry and selected-area corner markers are visible and usable. The current renderer boundary is therefore a release gate that later milestones must preserve.

Broader Android/iPhone browser hardening remains for M6.

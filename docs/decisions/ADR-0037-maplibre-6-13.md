# ADR-0037: MapLibre GL JS 6.13.0

Status: accepted for the integration branch; real-device acceptance open.
Date: 2026-10-09. Supersedes the 5.7.1 pin and the 5.7.1 audit exception; continues [ADR-0030](ADR-0030-maplibre-security-candidate.md) (candidate 6.9.0).

## Problem

`maplibre-gl` 5.7.1 (a runtime dependency) carries [GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579) (critical, `DOM.sanitize()`; fixed from 6.4.1). `scripts/audit-dependencies.mjs` waived it for exactly 5.7.1. The pin existed because 6.4.1 once broke saved-GeoJSON rendering in the old map, which is deleted ([ADR-0036](ADR-0036-legacy-map-retired.md)). The v5 field map renders vector tiles (`v5t://`) with `setFeatureState`, plus a few small GeoJSON sources (Gebiet outlines, route preview).

## Decision

Pin `maplibre-gl` to **6.13.0** (latest at the time). The package has no default export: `fieldMap.ts` uses the namespace import like the organiser map picker, and the tile-protocol handler is typed with `RequestParameters`. MapLibre 6 runs its tile and style work in a separate module worker file: `src/mapRuntime.ts` imports it with Vite's `?worker&url` (the bundler emits the worker with its shared chunk) and calls `setWorkerUrl`; both map entry points import it. Without it the map stays blank ("Worker failed to load", 404 on `/assets/maplibre-gl-worker.mjs`); the first browser run after the version bump found exactly that, which is why a version bump needs the browser flows, not only typecheck and build. The audit waiver is removed: the audit now fails on any high or critical advisory. Dev tooling is updated in the same change so `npm audit` reports zero: `wrangler` 4.149.0, `@cloudflare/vite-plugin` 1.63.1, override `sharp` 0.35.5.

## Evidence and limits

Typecheck, 446 unit tests, build, `npm run audit:dependencies` (zero vulnerabilities), a wrangler dry-run build of the staging worker and all 16 browser flows (tiles, feature-state painting, hit testing, selection, route, soak, mobile matrix) pass in headless Chromium with software WebGL. The flows read GeoJSON source contents through the private `_data` field, which MapLibre 6 no longer provides; they now use the public async `getSource(id).getData()`. That is not a real phone. Release gate (open): real iPad/Android check of tiles, marking, selection, camera and the basemap fallback.

## Rollback

Return to 5.7.1 only together with an explicit, dated audit exception; do not lower the audit threshold. A private fork is rejected (maintenance and security-patch burden). No deployment follows from this ADR.

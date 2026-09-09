# ADR-0030: Security-fixed renderer candidate

Status: accepted for the PR #92 WIP candidate, browser release acceptance open.
Date: 2026-09-09. Supersedes the 5.7.1 pin only on this candidate branch.

## Problem and decision

Exact PR #92 CI passed 827 tests and typecheck, but dependency audit found
[GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579): MapLibre
versions through 6.4.0 can retain a dangerous attribution HTML attribute while
sanitizing a live attribute collection. The upstream fix starts at 6.4.1.

Use pinned MapLibre 6.9.0 for the candidate, retaining its BSD-3-Clause license,
provider and storage architecture. The Admin map picker now imports the ESM
namespace because 6.9.0 has no default export. Keep audit severity unchanged.

The previously observed 6.4.1 saved-GeoJSON regression remains a release gate.
An audit pass or build does not prove the new renderer works in a real browser.
Require saved Areas, Streets, House polygons, hit testing, live property deltas,
selection, camera navigation and mobile interaction before promotion.

The rejected alternative is retaining vulnerable 5.7.1 with a lower audit threshold
or pretending an application workaround removes the dependency advisory. A private
renderer fork would add maintenance and a new security patch delivery obligation.

## Cloudflare development dependency

Override transitive sharp to 0.35.4, the patched version for
[GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
This keeps the Cloudflare plugin/Wrangler versions and updates the image-decoding
native dependency instead of npm's suggested breaking toolchain downgrade.
Local audit reports zero vulnerabilities after the update; build and typecheck
must remain explicit gates, and CI must verify its own platform-specific install.

## Rollback

Do not silently return a release candidate to a known vulnerable renderer. Keep
the current production runtime unchanged while browser acceptance is outstanding;
if 6.9.0 fails acceptance, isolate the regression or evaluate a maintained patched
alternative. No production deployment or remote migration follows from this ADR.

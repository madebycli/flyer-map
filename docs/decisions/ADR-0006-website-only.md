---
id: ADR-0006
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0006: Ship Verteil-Flyer as a mobile website only

## Context

The project originally planned an installable Progressive Web App to avoid native app-store distribution. During the first production tests, the product direction was simplified further: users should simply open the website in their normal browser.

The required MVP capabilities — interactive map, browser geolocation, shared state, manual distribution status and Cloudflare-hosted APIs — do not require PWA installation.

## Decision

Verteil-Flyer will be a mobile-first website only.

For the MVP:
- no native Android or iOS application;
- no Web App Manifest;
- no service-worker lifecycle for app installation;
- no product requirement to add/install the site on the home screen;
- browser geolocation and local browser storage remain allowed where they solve concrete product needs.

## Consequences

Positive:
- simpler runtime and deployment model;
- less browser-specific installation behavior;
- less caching complexity and fewer stale-version risks;
- smaller conceptual surface for users and coding agents.

Trade-offs:
- no standalone installed-app experience;
- no service-worker-based app-shell offline mode;
- connectivity resilience must focus on protecting important user mutations rather than pretending the whole website is offline-capable.

## Supersedes

ADR-0001 for the installable-PWA part of the product direction. The web-platform and single-codebase reasoning from ADR-0001 remains valid.

## Revisit when

A proven field requirement cannot be met well in ordinary mobile browsers and the additional installation/runtime complexity is justified.

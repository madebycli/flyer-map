---
id: ADR-0002
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0002: Use Cloudflare Workers as the deployment platform

## Context

The project needs lightweight static hosting, a small API and eventually a shared database while minimizing manual deployment work and recurring cost.

## Decision

Use Cloudflare Workers with Workers Static Assets and the Cloudflare Vite plugin. Use D1 for shared persistence unless later requirements demonstrate a better fit.

## Consequences

- frontend and API can deploy as one unit
- GitHub-driven deployment is straightforward
- no traditional server needs to be maintained
- platform-specific Worker/D1 APIs create some Cloudflare coupling

## Revisit when

Free-tier constraints, reliability or product requirements materially change.

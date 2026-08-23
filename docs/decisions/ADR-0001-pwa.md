---
id: ADR-0001
type: decision
status: accepted
date: 2026-08-24
---

# ADR-0001: Build Verteil-Flyer as a PWA

## Context

The application must work on common Android and iOS devices without requiring every field user to install a sideloaded build or depend on paid app-store developer distribution.

## Decision

Implement Verteil-Flyer as a mobile-first Progressive Web App.

## Consequences

Positive:
- one codebase
- direct web distribution
- homescreen installation
- normal browser geolocation
- rapid deployments

Negative:
- some deep native/background capabilities are limited

## Revisit when

A validated product requirement cannot reasonably be implemented with the web platform.

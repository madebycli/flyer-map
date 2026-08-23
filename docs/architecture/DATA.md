---
id: architecture-data
type: architecture
status: proposed
last_updated: 2026-08-24
related: [architecture-security, architecture-offline-sync]
source_of_truth_for: [domain-data-model]
---

# Data Model

## Initial entities

### Campaign

One flyer distribution effort.

Fields: id, name, status, created_at, updated_at.

### Team

Named group within a campaign.

Fields: id, campaign_id, name, color.

### Area

Geographic assignment.

Fields: id, campaign_id, team_id, name, geometry.

Geometry is initially stored as GeoJSON-compatible JSON text in D1. Introduce spatial infrastructure only if real queries require it.

### Task

One unit that can be marked during distribution.

Fields: id, campaign_id, area_id, task_type, label, geometry, source metadata, status, completed_at, updated_at.

## Status vocabulary

- open
- completed
- later
- not-deliverable

## IDs

Use opaque application IDs. Do not expose sequential database IDs as authorization secrets.

## Event history

An append-only task event table is expected before production hardening so accidental or conflicting state changes are diagnosable. It is intentionally not included in the first schema until synchronization semantics are designed.

## Migration source

SQL migrations under `/migrations` are the schema source of truth once D1 is enabled.

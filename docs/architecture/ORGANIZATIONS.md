---
id: architecture-organizations
type: architecture
status: proposed
last_updated: 2026-08-25
related: [product-roadmap, architecture-security, architecture-data]
source_of_truth_for: [future-organization-model, future-admin-panel-boundary]
---

# Organizations and Admin Platform — Proposed

## Purpose

This document defines constraints for the future multi-organization/Admin milestone. It is **not yet implemented** and does not change current Campaign authorization by itself.

## Target model

Future top-level hierarchy:

```text
Organization
  ├─ Organization members / administrators
  ├─ Campaigns
  │   ├─ Teams
  │   ├─ Areas
  │   └─ Tasks
  └─ Organization settings / operational overview
```

An Organization is a tenant boundary. Campaigns must belong to exactly one Organization once this model is introduced.

## Multiple admins

The product must support more than one authorized administrator. No design may assume that one original creator is the only durable owner.

Future admin capabilities may include:
- create/archive Campaigns;
- manage Organization settings;
- invite/remove administrators and other organization-scoped roles;
- review Campaign access;
- view organization-wide statistics/activity where authorized;
- recover/rotate access through an explicit safe process.

## Admin panel boundary

The Admin panel is a separate administrative surface, not a replacement for the field map.

Field map:
- map-first;
- minimal controls;
- Campaign/Team work;
- fast status updates.

Admin panel:
- organization/Campaign management;
- access and role management;
- statistics/reporting;
- automation configuration;
- audit/activity review;
- desktop-friendly layouts while remaining usable on mobile.

## Security requirements

Before implementation, define an explicit identity/membership architecture in an ADR.

Mandatory properties:
- organization scope enforced by the Worker/D1 query boundary;
- no cross-organization reads/writes;
- role changes/revocation take effect server-side;
- administrator recovery does not create an anonymous first-visitor ownership path;
- Campaign ids and Organization ids are selectors, never credentials;
- sensitive management operations have clear audit/activity records.

## Relationship to current M4 roles

Current roles are Campaign-scoped:
- Admin;
- Team Editor;
- Viewer.

They remain the current baseline until the organization slice explicitly migrates them. Do not silently reinterpret a Campaign Admin as an Organization Admin.

A future model may preserve Campaign roles below Organization membership, but the exact matrix is not yet accepted.

## Data migration constraints

Existing Campaigns must not disappear when Organizations are introduced.

A migration plan must:
- create an Organization container for legacy Campaigns or provide an explicit claiming/migration operation;
- preserve Campaign ids, geometry, revisions, access grants and history where possible;
- avoid race-to-claim ownership;
- be additive in D1 migrations.

## Open decisions

Require ADR/product design before implementation:
- account/identity model for Organization Admins;
- invitation and recovery mechanisms;
- whether ordinary field access links remain independent of organization login;
- role matrix and inheritance;
- organization deletion/export/retention;
- organization-scoped audit retention.

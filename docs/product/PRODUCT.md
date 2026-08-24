---
id: product
type: product
status: accepted
last_updated: 2026-08-24
---

# Product

## Problem

Flyer distribution is currently coordinated using map screenshots that are colored, shared through messaging apps and edited repeatedly. This causes degraded image quality, unclear current state and constant switching between the screenshot and a navigation/map application.

## Product promise

Verteil-Flyer provides one shared interactive map that answers three field questions quickly:

1. Where am I?
2. Which area is ours?
3. What has already been distributed and what is still open?

## Primary users

- participants distributing flyers;
- group coordinators;
- Campaign administrators.

The normal field user should not need technical knowledge, personal identity data or a traditional account setup. Access to a shared Campaign is granted through a revocable access link with an appropriate role.

## Core concepts

- Campaign: one distribution effort/time period, shown to users as an Aktion/Campaign depending on language.
- Team: a named group with an assigned display color.
- Area: a polygon or other bounded geographic assignment.
- Task: a street segment, building or manually defined distribution unit.
- Status: open, completed, later, or not-deliverable.
- Access: Campaign-scoped Admin, Team Editor or read-only Viewer permission.
- Campaign map focus: the shared default map view for a new browser/device.
- Personal map view: the last center/zoom/bearing saved only in that browser for that Campaign.

## Field interaction principles

- the map remains the primary workspace;
- selecting a saved Area in normal browse mode opens its details without adding edit vertices or a heavy white selection halo;
- polygon corner points appear only while drawing or explicitly editing geometry;
- the map may be freely rotated and a compass returns to North-Up;
- remote shared-data updates appear without a full website reload and do not reset the current camera;
- a running local draw/edit operation is never silently destroyed by a remote revision.

## Language

The application UI supports German and English as a personal browser setting. Browser language is used initially when it is German or English, otherwise German is the fallback.

The CARTO Voyager Retina basemap is raster imagery; its provider-rendered labels are not dynamically translated by the application language setting.

## Privacy principle

Device location is for local map orientation. The MVP does not record a GPS trail and does not upload continuous device location.

Personal camera state is also local browser preference. Moving the map does not upload a location history. Only an explicitly saved Campaign map focus is shared Campaign configuration.

## Long-term direction

The product should be reusable for future distribution Campaigns and improve over time without becoming operationally heavy or requiring classic user accounts for ordinary field participation.

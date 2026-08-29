---
id: status-current
type: status
status: active
last_updated: 2026-08-29
---

# Current Project State

## Product baseline

Verteil-Flyer ist eine mobile-first normale Website.

Technischer Kern:
- React, TypeScript und Vite;
- MapLibre GL JS 5.7.1 für die Feldkarte;
- Cloudflare Workers und D1 für Shared Runtime und Persistenz;
- M4 Access/Session, M5 resiliente Mutation-Synchronisierung und M5.5 vorbereitete Offline-Kartendaten bleiben etablierte Grundlagen.

Weiterhin ausgeschlossen:
- native App Runtime;
- installierbare PWA;
- Service Worker;
- Web App Manifest;
- Background Sync;
- kontinuierliche GPS-Historie.

## Active delivery

Plan 017 bleibt die übergeordnete Feature-Complete-Delivery-Linie.

Der aktuell geplante nächste sichere Slice ist Plan 018:
`docs/plans/active/018-house-polygon-renderer.md`.

Aktiver Entwicklungsstack:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- letzter vor diesem Planungs-Doku-Commit verifizierter Head: `2b90db509666d853dd20ac22a497536c88292522`;
- CI #701 war auf genau diesem Head vollständig grün mit Tests, TypeScript, Dependency Audit und Production Build;
- PR #72 war offen, Draft und mergeable.

GitHub und der aktuelle Branch-Head bleiben Source of Truth. Nach jedem neuen Commit muss CI erneut auf genau diesem neuen Head geprüft werden.

## Implementierter Plattformstand

Auf PR #72 sind die aktuellen Runtime-Slices für folgende Bereiche umgesetzt:
- FC0 PlatformShell/App Navigation und aktiver Teamkontext;
- Team Hub und Live Field Groups;
- Field Sessions und Einsatzhistorie;
- durable Comments für Campaign, Area, Street Task und persistierte House Tasks;
- bounded Activity-Projektion aus `domain_events`;
- erste feste deterministische und idempotente Automation gemäß ADR-0019;
- echte serverseitige Stats-Projektion mit getrennten Street-/House-Nennern.

## House renderer gap

House-Persistenz und House-Domain sind vorhanden, aber persistierte House Tasks werden im normalen MapLibre-Browse-Renderer noch nicht als eigene Polygone gerendert.

Der aktuelle Code hat bereits:
- `CampaignSnapshot.houseTasks` und `HouseTask.geometry` als Polygon;
- House-Auswahlzustand und House-Sheet in `App.tsx`;
- House-Kommentarkontext;
- Field-Session-Task-Refs für `street-task` und `house-task`.

Noch offen:
- eigene gebatchte House-GeoJSON-Source im normalen Renderer;
- feste House-Layer für Status, Auswahl und später Session-Highlight;
- House-Hit-Test über `queryRenderedFeatures`;
- Übergabe echter House-IDs in den bestehenden Session-Map-Highlight-Pfad.

Der bestehende Street-Renderer bleibt unverändert und darf nicht zu einer gemischten riskanten `vf-tasks`-Source umgebaut werden, solange dafür kein nachgewiesener Bedarf besteht.

## D1 rollout status

Dokumentierter Remote-Stand bleibt nur Migration 0001 bis 0003.

Vorbereitet, aber nicht remote angewendet:
- 0004: Smart Street provenance;
- 0005: House Tasks;
- 0006: Field Groups, Credentials, Memberships und FC1 Idempotency;
- 0007: Field Sessions und minimierte Domain Events;
- 0008: durable Comments und Comment-Tombstones;
- 0009: deterministische Automation-Konfiguration.

Der House-Renderer-Slice benötigt keine neue Migration und darf keine vorbereitete Migration remote anwenden.

## Security and performance boundaries

Weiterhin verbindlich:
- Worker bleibt authoritative Authorization Boundary;
- IDs sind Selektoren, keine Credentials;
- keine neue Permission- oder Identity-Runtime im Renderer-Slice;
- keine Secrets, Tokens oder unnötigen Domain-Daten in Renderer-Properties;
- persistierte House-Geometrie wird von MapLibre gerendert, nicht pro House durch React, SVG oder Canvas;
- feste kleine Source-/Layer-Anzahl statt Layer oder DOM-Nodes pro House;
- `GeoJSONSource.setData()` nur bei echten Domain-Datenänderungen, nicht bei Pan, Zoom oder Rotate;
- Dense-House-Daten müssen auf realistischen mobilen Geräten geprüft werden.

## Immediate next

1. Plan 018 gegen den exakten aktuellen Branch- und PR-Stand verifizieren.
2. House-Polygon-Rendering als separate `vf-houses`-Source im normalen MapLibre-Renderer implementieren.
3. Bestehenden House-Sheet-Pfad über Karten-Hit-Test anbinden.
4. Danach den vorhandenen Field-Session-House-Highlight-Pfad auf echte House-IDs erweitern.
5. Relevante Security-/Renderer-Tests, vollständige Testsuite, TypeScript, Dependency Audit und Production Build ausführen.
6. Dokumentation und Living Handoff auf dem finalen Head aktualisieren.
7. Keine Migration remote anwenden, nicht explizit deployen, nicht mergen und keinen neuen Branch oder PR erstellen.

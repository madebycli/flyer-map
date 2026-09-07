---
id: plan-023-auto-area-task-preparation
type: plan
status: completed
last_updated: 2026-09-01
related: [plan-feature-complete-platform, plan-smart-street-runtime, plan-smart-house-runtime, product-roadmap, map, data, offline-sync, security, quality, adr-offline-map-data, adr-smart-task-identity, ADR-0021]
source_of_truth_for: [automatic-area-task-preparation]
---

# Plan 023: Serverseitliche automatische Area-Vorbereitung

## Ziel

Eine gespeicherte Distribution Area erzeugt serverseitig aus begrenzten OpenStreetMap-Daten normale, dauerhaft in D1 gespeicherte Street- und House-Tasks. Der normale Snapshot transportiert diese Tasks an alle Geräte. Geräte erzeugen keine OSM-Kandidaten als Produktzustand.

## Ausgangslage und Grenzen

- Branch `plan-feature-complete-platform`, PR #72, Start-Head `865d103b145e9393147f413cdae9ce64657722ff`.
- D1 ist die maßgebliche Persistenz, M5 bleibt Schutz gegen kurze Verbindungsabbrüche.
- Die additive Migration 0014 wird nur vorbereitet, nicht remote angewendet.
- MapLibre, die bestehende Offline-Map-HTTP-API, die M5-Queue und die app-eigenen Task-IDs bleiben erhalten.
- Kein neuer Service, keine Queue, kein zusätzlicher Datenspeicher, kein Deploy, Merge oder Ready.

## Kontext

Relevante Context-Graph-Knoten: `data`, `offline-sync`, `security`, `quality`, `map`, `adr-offline-map-data`, `adr-smart-task-identity`, `plan-feature-complete-platform`.

## Arbeitspakete

1. Additive Schema- und Snapshot-Kompatibilität für Preparation-Generation und State.
2. Pure Geometrie für exaktes Road-Clipping und robuste Gebäude-Zuordnung.
3. Wiederverwendbare bounded OSM-Abfrage und serverseitige Publish-State-Machine.
4. M5-Trigger, Area-Geometrieschutz und enge Recovery-API mit Autorisierung.
5. Regressionstests, ADR, Architektur-/Status-/Roadmap-Dokumentation und exakte CI-Prüfung.

## Akzeptanzkriterien

- Ein erfolgreicher Durchlauf veröffentlicht atomar reale offene Street- und House-Tasks und erhöht die Campaign-Revision genau einmal.
- Automatische Tasks tragen OSM-Provenance plus Generation, manuelle Tasks bleiben unangetastet.
- Geometry-Edits nach begonnener automatischer Arbeit werden serverseitig abgelehnt.
- Nur erfolgreiche nicht wiederholte `area.create` und `area.update-geometry` planen einen Job.
- Fehlversuche veröffentlichen keine Teilmenge und ändern keine Campaign-Revision.

## Risiken und entschiedene Maßnahmen

- Upstream-Antworten können groß, fehlerhaft oder veraltet sein. Begrenzte Abfrage, Größenlimits, Feature-Caps und kontrollierte Fehlerzustände verhindern Teilpublishes.
- Gleichzeitige Area-Änderungen können einen Job veralten lassen. Generation, Geometry-Hash, gespeicherte Geometry und Campaign-Write-Token sichern den finalen Publish.
- Alte D1-Instanzen besitzen 0014 noch nicht. Der neue Pfad erkennt das fail-closed als vorbereitete Schema-Abhängigkeit, ohne bestehende M5-Pfade zu brechen.

## Nicht-Ziele

- Kein Massenvorbereiten alter Areas beim Rollout.
- Keine automatische Parent-Zuordnung House zu Street.
- Kein Entfernen manueller Tasks und kein Client-geliefertes BBox-/Geometry-Prep-Protokoll.
- Keine Änderung an MapLibre oder an der Produkt-UI in diesem Backend-Slice.

## Lieferung

- Prepared-only Migration 0014 erweitert State und Task-Provenance additiv.
- Der Worker verwendet eine server-owned Pending/Ready/Failed-State-Machine, bounded OSM-Daten, exaktes Road-Clipping und atomaren Publish mit genau einer Revision.
- Recovery ist Area-scope-autorisiert und akzeptiert keine clientseitige BBox oder Geometry.
- Automatische Task-Generationen sind gegen Client-Create/Delete/Rewrites geschützt; Statusänderungen bleiben normale Task-Operationen.
- Die verbleibende Produktarbeit ist ein separater UI-Follow-up für explizites Prepare/Retry älterer editierbarer Areas nach bewusstem Migration-0014-Rollout.

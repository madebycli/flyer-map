---
id: plan-024-auto-area-ui-server-preparation
type: plan
status: completed
last_updated: 2026-09-01
related: [plan-feature-complete-platform, plan-auto-area-task-preparation, plan-openfreemap-smartdata-ui-hardening, product-ux, map, offline-sync, quality, ADR-0021]
source_of_truth_for: [automatic-area-preparation-ui]
---

# Plan 024: Automatische Area-Vorbereitung im normalen UI

## Ergebnis

Der normale Distribution-Area-Sheet verwendet den serverautorisierten Preparation-Status. Fehlende Vorbereitung wird genau einmal gestartet, Pending wird nur bei offenem Sheet im Zwei-Sekunden-Takt gelesen und Ready löst einen normalen Snapshot-Refresh aus. Nach lokaler Area-Erstellung oder Geometrieänderung toleriert der Poller den kurzen M5-Persistenz-Race mit höchstens fünf weiteren `404 area_not_found`-Reads; Failed bietet berechtigten Rollen einen manuellen Retry, ein fehlendes 0014-Schema keinen Retry-Loop. Der serverseitige Overpass-Formularrequest verwendet den produktiv kompatiblen `application/x-www-form-urlencoded`-Content-Type ohne den abgelehnten Charset-Zusatz. Leere additive House-/Collection-Felder werden beim lokalen/kanonischen Vergleich gleich behandelt, echte Datenabweichungen bleiben Konflikte.

Die alten browserseitigen Smart-Street-/Smart-House-Aktionsbuttons, Paket-Fetches und der Settings-Download für Offline-Karten sind aus dem normalen Produktfluss entfernt. M5-Mutation-Queue, lokaler Snapshot-Cache und der bestehende Map-Kontext bleiben unverändert.

Automatisch vorbereitete Streets und Houses bleiben normale `vf-streets`-/`vf-houses`-Features. Erledigte Features erhalten die aus der Teamfarbe rein berechnete, um 25 Prozent abgedunkelte Farbe bei hoher Opazität. Automatische Streets sind umbenennungs- und löschgeschützt, Statusänderungen bleiben möglich.

## Verifikation

- fokussierte Polling-, UI-, Renderer- und M5-Regressionsprüfungen;
- vollständige lokale Testsuite: 584 bestanden;
- Production Build erfolgreich;
- der lokale Typecheck-Prozess ist in dieser Sandbox wegen des bekannten `/proc/self/exe`-Fehlers nicht ausführbar, GitHub CI bleibt dafür maßgeblich.

## Grenzen

- Migration 0014 bleibt prepared-only und wurde nicht remote angewendet;
- kein Deploy, Merge, Ready, neuer Branch oder PR;
- historische Smart-Domain- und MapLibre-Helfer bleiben ohne normalen UI-Einstieg erhalten;
- echte Android-/iPhone-WebGL-Abnahme bleibt offen.

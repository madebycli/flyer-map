---
id: plan-openfreemap-smartdata-ui-hardening
type: plan
status: completed
last_updated: 2026-08-31
related: [plan-feature-complete-platform, plan-offline-map, plan-smart-street-runtime, plan-smart-house-runtime, map, ux, collaboration, quality]
source_of_truth_for: [openfreemap-basemap-slice, smart-map-online-first, comment-retry-ui, mobile-area-sheet-hardening]
---

# Plan 022: OpenFreeMap, Smart Data und UI-Hardening

## Ziel

CARTO vollständig durch OpenFreeMap Liberty ersetzen, Hausnummern standardmäßig sichtbar machen und Smart Street/House ohne verpflichtenden Offline-Download online nutzbar machen. Gleichzeitig werden bekannte Comment-Retry- und mobile Area-Sheet-Probleme mechanisch behoben.

## Baseline / Source of Truth

Ausgangsstand:

- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- Start-Head `f17fbbbcf945441ccddcdbde1efe80edd4a3323b`;
- CI #813 auf exakt diesem Head erfolgreich;
- PR offen, Draft, mergeable und ungemergt;
- MapLibre 5.7.1 bleibt unverändert;
- Remote-D1 bleibt dokumentiert nur bis Migration 0003.

Der Live-Vertrag von `https://tiles.openfreemap.org/styles/liberty` wurde vor der Umsetzung geprüft: Source `openmaptiles`, Source-Layer `housenumber` und `Noto Sans Regular` sind vorhanden. Liberty hatte bei der Prüfung keinen eigenen Hausnummern-Layer, der mit dem App-Layer kollidiert.

## Architektur

### Basemap und Layer

MapLibre lädt Liberty direkt. Auf `style.load` werden alle festen Verteil-Flyer-Sources genau einmal installiert. Normale Kontextgeometrie liegt unter dem ersten Liberty-Symbol-Layer, Interaktions- und Pickup-Layer liegen oberhalb der Basemap-Labels.

Ein konstanter Symbol-Layer `vf-basemap-housenumbers` nutzt `openmaptiles` / `housenumber`, Noto Sans, `minzoom` 16 und normale Collision-Erkennung. Provider-Layer für denselben Source-Layer werden vor Installation entfernt.

### Smart Street und Smart House

Candidate-Priorität:

1. passendes gespeichertes Offline-Paket;
2. passendes ephemeres Online-Paket;
3. kein Paket.

Online wird das ausgewählte Area zentriert angefragt. Der Radius nutzt die maximale Distanz vom Bounds-Mittelpunkt zu den Ecken plus 50 m Puffer, mindestens 250 m und maximal 3.000 m. Alle Polygonpunkte müssen innerhalb der zurückgegebenen Bounds liegen. Zu große oder unvollständig abgedeckte Areas werden nicht als vollständige Candidate-Daten ausgegeben.

Nur Settings schreibt heruntergeladene Pakete in IndexedDB. Smart Street/House hält Online-Daten ausschließlich im React-State. Identische laufende Requests werden dedupliziert.

### UI-Hardening

- Offline ohne passendes Paket ergibt einen gemeinsamen Area-Sheet-Hinweis;
- Settings bezeichnet die Offline-Karte ausdrücklich als optional;
- Comment-Schema-, 401- und 403-Fehler bieten keinen Retry;
- Netzwerkfehler und temporäre 5xx-Fehler bieten Retry;
- mobile Area-/Task-Sheets erhalten vertikales Scrolling, keinen horizontalen Overflow und umbruchfähige lange Aktionen.

## Dateistruktur

Primär geändert:

- `src/map/MapView.tsx`;
- `src/map/offlineMapContext.ts`;
- `src/data/offlineMapApi.ts`;
- `src/domain/offlineMap.ts`;
- `src/App.tsx`;
- `src/settings/SettingsSheet.tsx`, geprüft und unverändert als alleiniger IndexedDB-Write;
- `src/i18n.ts`;
- `src/collaboration/CommentsContextPanel.tsx`;
- `src/collaboration/comments-context-panel.css`;
- `src/mobile-stability.css` und `src/styles.css`;
- gezielte Tests;
- `AGENTS.md`, `docs/architecture/MAP.md`, `docs/status/CURRENT.md` und Context Graph.

## Umsetzungsschritte

1. GitHub-Head, PR und CI verifizieren.
2. Liberty-Source-, House-Number- und Font-Vertrag live prüfen.
3. CARTO entfernen und App-Layer auf `style.load` installieren.
4. feste Layer-Reihenfolge inklusive bestehendem Pickup-Renderer sichern.
5. Map-Data-API in ephemeren Fetch und Settings-Wrapper teilen.
6. Coverage- und Area-Radius-Helper ergänzen.
7. Smart Street/House online-first mit Request-Dedupe verbinden.
8. Offline-Texte, Comment-Retry und mobile Sheets härten.
9. gezielte Regressionen und komplette Test-Suite ausführen.
10. Living Docs aktualisieren und CI auf dem finalen Head prüfen.

## Akzeptanz

- kein CARTO-Runtime-Code;
- Liberty ohne Secret konfiguriert;
- genau ein `vf-basemap-housenumbers`-Layer;
- Pickup Source/Marker/Selection bleiben erhalten;
- Smart Street und Smart House laden online ohne gespeichertes Paket;
- passendes Offline-Paket verhindert Online-Fetch;
- ephemerer Fetch schreibt nicht in IndexedDB;
- Offline-Hinweis erscheint gemeinsam;
- mehr als 3 km erforderliche Coverage wird abgelehnt;
- Retry-Matrix und mobile Overflow-Regeln sind getestet;
- Tests, Typecheck, Audit, Build und Check sind auf dem finalen CI-Head grün.

## Risiken

- Änderungen am externen Liberty-Schema: fail-fast statt stiller Ersatzquelle.
- Style-Ladezeit: App-Layer erst nach `style.load`, anschließend Sync aus aktuellem `dataRef`.
- Layer-Regressionsrisiko: feste Quellen/Layers und Pickup-Regressionstests.
- große Areas: keine Partial-Candidates als vollständig darstellen.
- fehlendes echtes WebGL oder Gerät: visuelle Abnahme ausdrücklich offen lassen.

## Nicht-Ziele

- kein MapLibre-Upgrade;
- keine neue Kartenengine;
- keine zweite Mutation Queue;
- keine automatische IndexedDB-Persistenz aus Smart Street/House;
- keine Remote-Migration;
- kein manueller Deploy;
- kein Merge oder Ready-for-Review;
- kein neuer Branch oder PR;
- kein Redesign.

## Verifizierter Abschluss

Die lokale Node-Test-Suite ist mit 555 von 555 Tests grün. Typecheck, Dependency Audit, Production Build und `check` werden durch die bestehende GitHub-CI auf dem exakten finalen Branch-Head verifiziert. Eine echte WebGL-, Android- oder iPhone-Abnahme wurde nicht behauptet.

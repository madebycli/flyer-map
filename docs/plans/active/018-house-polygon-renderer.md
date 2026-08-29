---
id: plan-house-polygon-renderer
type: plan
status: active
last_updated: 2026-08-29
related: [plan-feature-complete-platform, map, collaboration, adr-smart-task-identity, quality]
source_of_truth_for: [house-polygon-renderer-slice, house-map-selection-plan, house-session-highlight-plan]
---

# Plan 018: House Polygon Renderer

## Ziel

Persistierte `HouseTask`-Polygone im echten normalen MapLibre-Renderer anzeigen und direkt auf der Karte auswählbar machen.

Der Slice schließt die aktuelle FC4-Renderer-Lücke innerhalb von Plan 017, ohne Backend-Umbau, neue Berechtigungen, neue Migration oder neue Sync-Architektur.

Nach stabilem Renderer-Core darf derselbe Slice den bereits vorhandenen Field-Session-Highlight-Pfad von `houseTaskCount` auf echte `houseTaskIds` erweitern, weil der autorisierte Session-Task-Read diese IDs bereits liefert.

## Baseline / Source of Truth

Vor jeder Umsetzung neu prüfen:
- `AGENTS.md`;
- `docs/status/CURRENT.md`;
- `docs/context-map.yaml`;
- diesen Plan;
- `docs/architecture/MAP.md`;
- `docs/architecture/COLLABORATION.md`;
- `docs/decisions/ADR-0010-maplibre-geojson-saved-geometry-svg-active-editing.md`;
- `docs/decisions/ADR-0013-smart-street-house-identity.md`;
- relevante Renderer-, House-, Session- und Quality-Tests;
- exakten Branch-, PR- und CI-Stand auf GitHub.

Zuletzt vor diesem Planungscommit verifiziert:
- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- Head `2b90db509666d853dd20ac22a497536c88292522`;
- CI #701 vollständig grün;
- PR offen, Draft und mergeable.

Ein neuerer GitHub-Stand ersetzt diese Angaben sofort.

## Implementierungscheckpoint 2026-08-29

Der Renderer-Core und der anschließende Session-Highlight-Checkpoint sind im aktuellen Arbeitsstand umgesetzt:
- neue gebatchte `vf-houses`-Source und feste House-Layer im normalen MapLibre-Style;
- `housesToGeoJson()` verwendet stabile App-House-IDs und nur die Properties `houseTaskId`, `status` und `color`;
- House-Auswahl nutzt den bestehenden `selectHouseTask()`-/House-Sheet-Pfad;
- Street-, House- und Area-Hit-Test bleiben in dieser Reihenfolge;
- Domain-`setData()`-Pfade sind für Areas, Streets und Houses getrennt, Filteränderungen lösen kein House-`setData()` aus;
- Field-Session-Refs transportieren echte `houseTaskIds`, House-only Sessions werden nicht mehr ausgefiltert;
- Renderer-Diagnose und lokale Dichteprüfung decken House-Sets bis 20.000 Features ab.

Noch ausstehend sind die reale Android-/iPhone-Prüfung, TypeScript, Dependency Audit, Production Build, der finale `check`-Lauf und der CI-Nachweis auf dem finalen GitHub-Head.

## Relevante Context-Graph-Knoten

- `prompt-house-polygon-renderer`
- `plan-house-polygon-renderer`
- `plan-feature-complete-platform`
- `map`
- `ux`
- `collaboration`
- `quality`
- `adr-smart-task-identity`
- `security` nur zur Bestätigung der unveränderten Authorization-Grenze
- `offline-sync` nur falls der Slice unerwartet Mutation-/Sync-Verhalten berührt

## Anforderungen

### Renderer

- Houses stammen ausschließlich aus `CampaignSnapshot.houseTasks`.
- Fehlt `houseTasks`, rendert die Karte null Houses und bleibt rückwärtskompatibel.
- Persistierte Houses werden von MapLibre gerendert, nicht von React, SVG oder Canvas.
- Houses erhalten eine eigene gebatchte GeoJSON-Source, sinngemäß `vf-houses`.
- Source- und Layer-Anzahl bleibt konstant, unabhängig von der Anzahl der Houses.
- Keine Layer, Marker oder React-Komponente pro House.
- `GeoJSONSource.setData()` wird nur bei echten House-/Team-Datenänderungen verwendet.
- Pan, Zoom und Rotate dürfen keine Schleife zur Projektion aller persistierten Houses auslösen.
- OSM-IDs bleiben Provenance, niemals Renderer- oder Task-Identity. Auswahl verwendet die stabile App-House-ID.

### Darstellung

- House-Statuswerte bleiben visuell unterscheidbar.
- Kritischer Zustand darf nicht ausschließlich über Farbe kommuniziert werden.
- Teamfarbe darf den House-Kontext unterstützen.
- Selected House erhält eine klar erkennbare eigene Hervorhebung.
- Streets bleiben visuell klar lesbar und dürfen durch Houses nicht unbrauchbar verdeckt werden.
- Die normale Area-Darstellung bleibt erhalten.

UNKLAR: finaler House-`minzoom`. Er wird anhand eines Dense-Mobile-Tests festgelegt, nicht per Bauchgefühl.

UNKLAR: exakte Status-Stile. Mindestens ein zweiter visueller Kanal neben Farbe ist erforderlich.

### Auswahl

- Browse-Hit-Test verwendet `queryRenderedFeatures`.
- Bestehende Street-Auswahl darf nicht regressieren.
- Für den ersten sicheren Slice bleibt die Hit-Test-Reihenfolge: Street, House, Area.
- House-Treffer ruft den bereits vorhandenen House-Selection-Pfad in `App.tsx` auf.
- Ein Kartenklick auf ein House öffnet damit das bereits vorhandene House-Sheet und dessen Kommentarkontext.

UNKLAR: Ein späterer expliziter House Mode darf die Priorität ändern. Das gehört nicht in diesen Renderer-Core.

### Field Session Highlight

Nach stabilem Renderer-Core:
- bestehende autorisierte `house-task`-Refs als echte `houseTaskIds` bis zur Karte transportieren;
- aktuelles persistiertes House-Polygon hervorheben;
- keine historische Geometriekopie und keine GPS-Route erzeugen;
- Street-only, House-only und gemischte Sessions korrekt behandeln;
- der bisherige Hinweis, Houses seien nur im Verlauf sichtbar, entfällt nur wenn das House tatsächlich renderbar ist.

### Sicherheit

- Keine neue Authorization.
- Keine neue API für House-Rendering.
- Keine Permission wird aus UI-Sichtbarkeit abgeleitet.
- House Tasks stammen aus dem bereits autorisierten Campaign Snapshot.
- IDs bleiben Selektoren und keine Credentials.
- Keine Secrets, Tokens, Session-Hashes, QR-/Room-Credentials oder unnötigen Domain-Felder in GeoJSON-Properties.
- Field-Session-House-Highlight verwendet nur bereits autorisiert geladene Task-Refs.

### Skalierbarkeit

- Eine House-Source statt House-spezifischer DOM-/Layer-Strukturen.
- Wenige feste MapLibre-Layer.
- Keine `map.project()`-Schleife für persistierte Houses.
- Keine `setData()`-Aktualisierung bei jeder Kamerabewegung.
- Dense-House-Datensatz mit realistisch großer FeatureCollection prüfen.
- Reale mobile Geräte beziehungsweise vergleichbare langsame Profile für Interaktion und Rendering prüfen.

### Kosten

- Keine neue Infrastruktur.
- Keine neuen Drittanbieter-APIs.
- Keine neue Cloudflare-Ressource.
- Keine zusätzliche D1-Persistenz.
- Hauptkosten bleiben Client-Rendering und Größe des ohnehin geladenen autorisierten Snapshots.

## Architektur

### Gewählter Ansatz

Eigene gebatchte House-GeoJSON-Source parallel zu Areas und Streets.

```text
CampaignSnapshot.houseTasks
        |
        v
App.tsx
- Area -> Teamfarbe auflösen
- RenderHouse[] erzeugen
        |
        v
MapView.tsx
        |
        v
houseRenderer.ts
- housesToGeoJson()
- feste Source-/Layer-IDs
        |
        v
MapLibre
vf-houses
        |
        +-> House Status/Fill
        +-> House Outline
        +-> Selected House
        +-> Session Highlight
        |
        v
queryRenderedFeatures()
        |
        v
onHouseTaskSelect(id)
        |
        v
bestehendes App.selectHouseTask()
        |
        v
bestehendes House-Sheet
```

`vf-streets` bleibt Street-only.

### Verworfene Alternative

Streets und Houses in eine neue gemeinsame `vf-tasks`-Source umbauen.

Nicht gewählt, weil:
- bestehender stabiler Street-Renderer unnötig angefasst würde;
- Selection-, Status- und Session-Highlight-Regressionsrisiko steigt;
- größerer Diff ohne zusätzlichen Produktnutzen für diesen Slice;
- die separate Source die einfachste Architektur ist, die die Anforderungen erfüllt.

Komplexität des gewählten Ansatzes: mittel.

## Dateistruktur

### 1. `src/map/houseRenderer.ts`

Neue kleine Renderer-Grenze:
- `HOUSE_SOURCE_ID`;
- feste House-Layer-IDs;
- House-FeatureCollection-Typ;
- `housesToGeoJson()`;
- minimale Properties `houseTaskId`, `status`, `color`;
- pure Layer-/Filter-Helper, soweit sie `MapView.tsx` tatsächlich vereinfachen.

Keine Credentials und keine unnötigen Domain-Metadaten.

### 2. `tests/houseRenderer.test.ts`

Testet mindestens:
- unveränderte Polygon-Geometrie;
- stabile App-House-ID;
- Status und Teamfarbe;
- leere FeatureCollection;
- keine OSM-ID als Identity;
- keine Source-Provenance in Renderer-Properties;
- konstante Layer-Struktur;
- Filter auf `houseTaskId`.

### 3. `src/map/MapView.tsx`

Erweitern um:
- `RenderHouse[]`;
- `selectedHouseTaskId`;
- `onHouseTaskSelect`;
- `vf-houses`-Source und feste House-Layer;
- House-`setData()` in `syncApplicationData()`;
- Selected-House-Filter;
- House-Hit-Test;
- Renderer-Diagnostics `sourceHouses` und `renderedHouses`.

Weitere direkte Integrationsdateien:
- `src/App.tsx` für echte `snapshot.houseTasks` und vorhandenes `selectHouseTask()`;
- `src/platform/sessionMapHighlight.tsx` und `src/platform/PlatformShell.tsx` erst für den zweiten Session-Highlight-Checkpoint;
- `src/collaboration/FieldSessionsHub.tsx` nur falls House-only Sessions bisher wegen fehlendem Renderer blockiert werden;
- passende bestehende Tests erweitern.

## Umsetzungsschritte

1. Exakten Workspace-Status prüfen. Lokale Änderungen niemals blind überschreiben.
2. Branch, PR #72, exakten Head und CI erneut gegen GitHub verifizieren.
3. Relevante Graph-Knoten und accepted Renderer-/House-ADRs lesen.
4. Bestehende `MapView.tsx`, `App.tsx`, House-Domain und Session-Highlight-Pfade vollständig nachvollziehen.
5. `houseRenderer.ts` mit minimalem House -> GeoJSON-Contract erstellen.
6. Pure Unit-Tests für Renderer-Contract und konstante Layer-Struktur erstellen.
7. `MapView` um eigene House-Source und feste Layer ergänzen.
8. `App.tsx` mit echten `snapshot.houseTasks` an den Renderer anbinden.
9. Selected-House-Layer und Browse-Hit-Test ergänzen, Reihenfolge Street, House, Area.
10. Rückwärtskompatibilität für `houseTasks === undefined` prüfen.
11. Renderer-Diagnostics um House-Zahlen erweitern.
12. Dense-House-Performance prüfen, insbesondere keine per-frame React-/Projection-Arbeit und keine Layerzahl proportional zur House-Anzahl.
13. Mobile Tap-Verhalten bei kleinen Gebäuden und Street-Überlappung prüfen.
14. Nach stabilem Renderer-Core Session-Highlight um echte `houseTaskIds` erweitern.
15. House-only und gemischte Sessions prüfen.
16. Relevante Security-/Regressionstests ausführen.
17. Vollständige Testsuite ausführen.
18. TypeScript prüfen.
19. Dependency Audit ausführen.
20. Production Build ausführen.
21. Dokumentation, Plan 018, `CURRENT.md`, Context Graph und Living Handoff auf den tatsächlichen Runtime-Stand aktualisieren.
22. PR #72 weiter Draft lassen und finalen CI-Lauf auf exakt dem letzten Head verifizieren.

## Akzeptanzkriterien

- Persistierte Houses sind im normalen Browse-Renderer sichtbar.
- House-Klick öffnet den bestehenden House-Kontext.
- Street- und Area-Auswahl funktionieren weiterhin.
- House-Layer-Anzahl ist unabhängig von der House-Anzahl konstant.
- Pan, Zoom und Rotate führen nicht zu React-Projektion aller persistierten Houses.
- House-Source wird bei Domain-Datenänderung aktualisiert, nicht bei Kamerabewegung.
- Alte Snapshots ohne `houseTasks` funktionieren.
- Keine neue Authorization oder Migration wurde eingeführt.
- House-Session-Highlight funktioniert nach dem zweiten Checkpoint für echte House-IDs.
- Relevante Tests, vollständige Testsuite, TypeScript, Dependency Audit und Production Build sind grün.
- Finaler GitHub-CI-Lauf gehört exakt zum finalen PR-Head.

## Risiken

- Zu viele sichtbare Houses bei niedrigem Zoom können Fill-Rate und Lesbarkeit verschlechtern.
- Kleine Gebäude können auf Touch-Geräten schwer zu treffen sein.
- Street-Hitbox und House-Polygon können sich überlagern.
- Ein unvorsichtiger gemeinsamer Task-Renderer könnte den stabilen Street-Pfad regressieren.
- Session Highlight darf keine nicht mehr vorhandene oder fremde Geometrie erfinden.

Mitigation:
- separater `vf-houses`-Pfad;
- konstante Layerzahl;
- kontrollierter Hit-Test;
- Dense-Mobile-Test;
- fehlende House-ID einfach nicht hervorheben;
- keine historische Geometriekopie.

## Entscheidungen

- Separate `vf-houses`-Source ist der bevorzugte und für diesen Slice festgelegte Ansatz.
- `vf-streets` bleibt unverändert Street-only.
- Kein neuer Backend-/D1-Pfad für Rendering.
- Bestehender House-Sheet-Pfad wird wiederverwendet.
- House Session Highlight wird erst nach stabilem normalen Renderer aktiviert.
- Keine neue irreversible Architekturentscheidung ist für den Renderer-Core erkennbar.

## Nicht-Ziele

- keine neue House-Persistenz;
- keine Migration remote anwenden;
- kein Deploy;
- kein Merge;
- kein neuer Branch oder PR;
- kein vollständiger Smart-House-Creation-Workflow;
- kein neuer House Mode mit geänderter Interaktionspriorität;
- kein Pickup-Modell;
- keine Organization-/Identity-/Capability-Runtime;
- keine PWA, kein Service Worker, kein Background Sync;
- keine GPS-Historie;
- keine allgemeine Renderer-Abstraktion nur um Abstraktion zu erzeugen.

## Offene Fragen / Unklarheiten

- UNKLAR: finaler House-`minzoom`, nach Dense-Mobile-Test entscheiden.
- UNKLAR: finale Status-Stile, sie müssen neben Farbe einen zweiten visuellen Kanal besitzen.
- UNKLAR: spätere House-Mode-Hit-Test-Priorität, nicht Teil dieses Renderer-Cores.

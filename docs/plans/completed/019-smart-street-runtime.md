---
id: plan-smart-street-runtime
type: plan
status: completed
last_updated: 2026-08-29
related: [plan-feature-complete-platform, plan-offline-map, map, ux, offline-sync, adr-offline-map-data, adr-smart-task-identity, quality]
source_of_truth_for: [smart-street-runtime-slice, fc4-smart-street-selection]
---

# Plan 019: Smart Street Selection im normalen Area-Flow

## Ziel

Der erste echte FC4-Produktweg bringt einen berechtigten Nutzer von einem vorhandenen
Gebiet bis zu einem persistenten Smart Street Task. Die Straße wird aus einem bereits
vorbereiteten, echten OSM-Kartenpaket vorgeschlagen, auf der normalen MapLibre-Karte
ausgewählt, als geprüfte LineString-Geometrie gespeichert und danach wie jeder andere
Street Task über `vf-streets` gerendert.

Manuelles Einzeichnen bleibt als klarer Fallback verfügbar. Die M6-Workbench bleibt
Entwicklungs- und Prüfmaterial und wird nicht zum Produktionsdatenfluss.

## Baseline / Source of Truth

Vor der Umsetzung wurden Working Tree, Branch, PR und CI erneut geprüft:

- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- Ausgangs-Head `9477e1d15aada83db145cd9dd27b10a152cd13f7`;
- CI #704 war auf genau diesem Head erfolgreich;
- Migration 0004 und alle späteren vorbereiteten Migrationen waren nicht remote angewendet.

Der spätere exakte Folgeslice-Head steht in `docs/status/CURRENT.md`. Repository und
GitHub bleiben auch für diesen Plan die alleinige Source of Truth.

## Architekturprüfung und Entscheidung

### Echte Kandidatenquelle

Der normale Flow verwendet ausschließlich `OfflineMapPackage` aus dem vorhandenen
IndexedDB-Repository. `smartCandidatesForArea()` filtert daraus echte Straßen innerhalb
des ausgewählten Area-Polygons und übernimmt OSM-Way-ID und Tags als Provenance bzw.
Anzeigedaten. Ohne vorbereitetes Paket oder ohne Treffer bleibt Smart Street deaktiviert
und der manuelle Fallback sichtbar.

`PREVIEW_ROADS`, Mock-Daten und `M6SelectionPreview.tsx` sind nicht Teil des normalen
Produktgraphen.

### UI- und Kartenfluss

Die kleinste passende Integration ist:

`Area Sheet -> Smart-Street-Map-Mode -> MapLibre-Kandidaten -> Start/Ende/Route -> Vorschau -> Speichern`

Die Area-Sheet-Aktion wird nur innerhalb der bestehenden `canEditSelectedArea`-Grenze
angeboten. Der Map-Mode nutzt feste GeoJSON-Sources und Layer in `MapView.tsx`:

- Kandidatenstraßen;
- gewählte Kandidatenstraßen;
- geprüfte Vorschau-LineString;
- Start-, Ende- und Zwischenpunkt-Markierungen.

MapLibre `queryRenderedFeatures()` liefert die tatsächlich getroffenen Kandidaten. Es
gibt keine separate SVG-Kartenskizze, keinen Hover-only-Weg und keine eigene Kartenengine.

### Auswahl und Mehrdeutigkeit

Die bestehende Domain-Logik bleibt maßgeblich:

- Punkt wird auf echte Straßenabschnitte gesnappt;
- mehrere Treffer werden als explizite Auswahl angezeigt;
- Start und Ende werden über die vorhandene Topologie verbunden;
- mehrere gleich kurze Routen werden nicht geraten, sondern als Optionen angezeigt;
- Zwischenpunkte können eine gewünschte Route erzwingen;
- nicht verbundene Auswahl wird verständlich zurückgewiesen;
- die Vorschau wird aus der geprüften, gesnappten Auswahl erzeugt.

### Persistenz, Identity und Rechte

`createSmartStreetTaskSnapshot()` erzeugt die normale persistierbare
`DistributionTask`-Form:

- `task_<uuid>` bleibt die alleinige App-ID;
- `source.objectIds` enthält die OSM-Way-IDs ausschließlich als Provenance;
- die gespeicherte LineString-Geometrie ist ein App-eigener Snapshot;
- `commitSnapshot()` führt in den bestehenden `deriveCampaignMutation()`- und
  IndexedDB-M5-Queue-Pfad;
- der Worker bleibt die authoritative Authorization Boundary.

Es wird keine clientseitige Permission-Regel, keine neue Queue und kein zweiter
Synchronisationspfad eingeführt. Der vorhandene Duplicate-Submit-Schutz verhindert,
dass ein mehrfaches Tippen mehrere lokale Tasks erzeugt.

### Migration und Rollout

Smart-Task-Provenance benötigt die vorbereitete Spalte aus Migration 0004. Der Runtime-
und Testpfad ist implementiert, aber ein Worker ohne `source_json`-Spalte verweigert den
geschützten Source-Write ausdrücklich mit `schema_migration_required`. Diese Migration
wird in diesem Slice nicht remote angewendet. Offline-Erstellung, Retry, Konflikt und
Access-Fehler bleiben dem bestehenden M5-Pfad überlassen.

## Umgesetzter Vertical Slice

- Area Sheet bietet für berechtigte Nutzer „Straße aus Kartendaten auswählen“.
- Das Paket wird aus `MapView` an den normalen App-Flow übergeben und für das aktive Area
  mit `smartCandidatesForArea()` ausgewertet.
- MapLibre rendert die reale Kandidaten- und Auswahlgeometrie gebatcht.
- Start, Ende, Zwischenpunkte, Kandidaten-Mehrdeutigkeit, alternative Routen,
  Abbruch und nicht verbundene Auswahl sind im mobilen Sheet bedienbar.
- Nach Bestätigung entsteht ein normaler persistierter Street Task mit App-ID und OSM-
  Provenance.
- `vf-streets` bleibt der einzige Renderer für gespeicherte Street Tasks.
- Die manuelle Street-Zeichnung ist ausdrücklich als sekundärer Fallback erreichbar.

## Tests und Verifikation

Zusätzlich zu den vorhandenen Domain- und Persistenztests schützt
`tests/smartStreetRuntime.test.ts` den Produktionsgraphen, den MapLibre-Hit-Test, die
getrennten `setData()`-Pfade, die App-ID/Provenance-Grenze, die bestehende Mutation Queue
und die Area-Berechtigungsgrenze.

Die lokale serielle Gesamtsuite lief nach Anlegen des vorhandenen `/tmp`-Verzeichnisses
mit 450 von 450 Tests erfolgreich. Der finale TypeScript-, Audit-, Build- und `check`-
Nachweis gehört zum GitHub-CI-Lauf auf dem exakten finalen Branch-Head.

## Bewusste Grenzen

- Keine Smart-House-Kandidatenauswahl im normalen Produktweg; das ist der nächste FC4-
  Slice.
- Keine automatische Download-Anforderung aus dem Smart-Street-Button; das bestehende
  Settings-Offline-Paket bleibt die Datenquelle.
- Keine clientseitige OSM-Datenbank, kein OSM-ID-Keying, keine neue Routing-Engine und
  kein AI-/LLM-Routing.
- Keine Remote-Migration, kein Deploy, kein Merge, kein neuer Branch oder PR.
- Echte Android-/iPhone-Abnahme, Touch-Dichte und House-Dense-Mobile-Verhalten bleiben
  offene Quality-Gates und werden nicht durch Cloud-Browser-Tests fingiert.

## Abschluss und nächster Slice

Plan 019 ist als Runtime-Slice abgeschlossen. Die FC4-Linie aus Plan 017 bleibt aktiv,
weil Smart House Candidate Selection, die vollständige Geräteabnahme und weitere
Hardening-Gates noch fehlen. Der nächste kleinste normale Produktweg ist die Nutzung
derselben vorbereiteten Gebäude-Kandidaten für die bestehende House-Persistenz mit
optionalem Parent-Street-Bezug.

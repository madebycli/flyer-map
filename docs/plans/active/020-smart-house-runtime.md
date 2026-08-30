---
id: plan-smart-house-runtime
type: plan
status: active
last_updated: 2026-08-30
related: [plan-feature-complete-platform, plan-smart-street-runtime, plan-m6-house-persistence, plan-house-polygon-renderer, plan-offline-map, map, ux, data, offline-sync, security, adr-offline-map-data, adr-smart-task-identity, quality]
source_of_truth_for: [smart-house-runtime-slice, fc4-smart-house-selection, preview-schema-gate-hardening]
---

# Plan 020: Smart House Selection im normalen Produktweg

## Ziel

Der nächste FC4-Vertical-Slice bringt die bereits vorhandene Smart-House-Foundation in den echten normalen Produktweg. Berechtigte Nutzer wählen reale Gebäude aus dem bereits vorbereiteten und validierten OSM-Paket auf der normalen MapLibre-Karte aus, prüfen die Auswahl und erzeugen daraus persistierte `HouseTask`s mit stabilen App-IDs, optionalem expliziten Parent-Street-Bezug und OSM-Provenance.

Der Slice enthält außerdem ein kleines, verbindliches Preview-/Schema-Gate-Hardening. Die aktuelle Cloudflare-Testseite läuft dokumentiert weiterhin nur mit Remote-Migration 0001 bis 0003. Fehlende spätere Tabellen dürfen deshalb Funktionen blockieren, aber sie müssen fail-closed und verständlich als noch nicht ausgerollter Schema-Stand erscheinen. Ein generischer 500-Fehler bei einem bekannten fehlenden Schema ist nicht akzeptabel.

Keine Migration wird in diesem Plan remote angewendet. Kein manueller Deploy, kein Merge und kein neuer Branch/PR gehören zu diesem Slice.

## Baseline / Source of Truth

Vor Planerstellung erneut gegen GitHub verifiziert:

- Branch `plan-feature-complete-platform`;
- Draft PR #72 gegen `ui-app-launcher-sheet`;
- exakter Ausgangs-Head `fd333269eb40e0f32460328fa9b44e59a71afba0`;
- PR #72 offen, Draft und mergeable;
- CI #706 auf exakt diesem Head `success`;
- Plan 018 House Renderer abgeschlossen;
- Plan 019 Smart Street Runtime abgeschlossen;
- redundante Launcher-Kachel `Karte` entfernt;
- dokumentierter Remote-D1-Stand weiterhin nur Migration 0001 bis 0003;
- Migration 0004 bis 0009 vorbereitet, aber nicht remote angewendet.

GitHub und das Repository bleiben Source of Truth. Wenn der Branch vor Beginn der Runtime-Arbeit weitergelaufen ist, gilt ausschließlich der neuere Stand.

## Relevanter Context Graph

Mindestens laden:

- `plan-feature-complete-platform`;
- `plan-smart-street-runtime`;
- `plan-m6-house-persistence`;
- `plan-house-polygon-renderer`;
- `plan-offline-map`;
- `map`;
- `ux`;
- `data`;
- `offline-sync`;
- `security`;
- `adr-offline-map-data`;
- `adr-smart-task-identity`;
- `quality`.

Accepted ADRs und aktueller Runtime-Code schlagen ältere Workbench-/Preview-Annahmen.

## Verifizierte vorhandene Foundation

### Kandidatenquelle

`smartCandidatesForArea(area, pkg)` liefert bereits aus einem validierten `OfflineMapPackage`:

- echte OSM-Straßenkandidaten;
- echte OSM-Gebäudekandidaten;
- Gebäude-Adresselemente als inert behandelte Tags;
- stabile Source-Referenz `way/<osm id>` plus numerische OSM-ID als Provenance.

Es dürfen keine `PREVIEW_*`-, Mock- oder hardcodierten Gebäude in den normalen Produktgraph gelangen.

### House-Auswahl-Domain

Vorhanden:

- `toggleSmartBuildingSourceId()`;
- `selectSmartBuildingsForStreet()`;
- `smartBuildingLabel()`;
- `SmartHouseSelectionPanel` als bisherige UI-Foundation.

Die Domain-Logik darf wiederverwendet werden. Die bestehende Panel-Implementierung darf jedoch nicht ungeprüft Tausende Gebäude als DOM-Liste rendern.

### House-Persistenz

`createSmartHouseTaskSnapshot()` erzeugt bereits:

- `task_<uuid>` als App-eigene House-ID;
- Campaign-/Area-Bezug;
- geprüften Polygon-Snapshot;
- OSM-Way-ID ausschließlich in `source`;
- optionalen `parentStreetTaskId`;
- initialen Status `open`.

`house.create`, Snapshot-Validierung, Worker-Autorisierung, D1-Persistenz und Migration-0005-Gating sind bereits getestet.

### House-Renderer

Persistierte Houses werden bereits über die gebatchte `vf-houses`-Source im normalen MapLibre-Renderer dargestellt. Plan 020 baut keinen zweiten Persisted-House-Renderer.

## Architekturentscheidung

### Option A: eigener Smart-House-Kandidatenmodus in MapLibre

Flow:

`Area/Street Sheet -> Smart House Mode -> vorbereitete Building Candidates -> MapLibre Hit-Test -> Auswahl -> Review -> House Persistenz -> vf-houses`

Technik:

- derselbe vorbereitete `OfflineMapPackage`-Kontext wie Plan 019;
- `smartCandidatesForArea(...).buildings` als Domain-Kandidaten;
- eigene temporäre gebatchte GeoJSON-Source `vf-smart-house-candidates`;
- wenige feste Candidate-/Selected-Layer;
- `queryRenderedFeatures()` für Tap-Auswahl;
- bestehende House-Persistenz und bestehender `vf-houses`-Renderer danach.

Vorteile:

- echte Karte bleibt Interaktionsfläche;
- online und offline gleicher vorbereiteter Kandidatensatz;
- kein DOM/Layer pro Gebäude;
- Persisted Houses und flüchtige Kandidaten bleiben sauber getrennt;
- kleinster Anschluss an Plan 019 und Plan 018.

### Option B: vorhandenen Offline-Building-Layer oder reine Checkbox-Liste direkt verwenden

Nicht wählen.

Gründe:

- `vf-offline-buildings` ist an den Offline-Basemap-Modus gekoppelt und nicht der normale Smart-House-Interaktionsvertrag;
- keine saubere Selected-/Review-Darstellung;
- eine vollständige Checkbox-Liste skaliert bei dichten Stadtgebieten schlecht;
- Candidate- und Persisted-House-Verantwortung würden vermischt.

### Entscheidung

Option A wird umgesetzt. Es entsteht keine neue Kartenengine, keine Renderer-Registry und keine zweite OSM-Datenquelle.

## Ziel-UX

### Area-Einstieg

Für `canEditSelectedArea` erhält das normale Area-Sheet eine Aktion sinngemäß:

`Häuser aus Kartendaten auswählen`

Ohne vorbereitetes Offline-/OSM-Paket:

- Smart House bleibt deaktiviert bzw. zeigt einen klaren Hinweis;
- der Nutzer wird auf den bestehenden Paket-Download in den Einstellungen verwiesen;
- kein Fake-Fallback wird erzeugt.

### Street-Einstieg

Ein bestehender persistierter Street Task darf denselben Smart-House-Modus mit explizitem Parent-Kontext öffnen, sinngemäß:

`Häuser zu dieser Straße auswählen`

Dann gilt `parentStreetTaskId = selectedTask.id` für die in diesem bestätigten Vorgang erzeugten Houses.

Wichtig:

- Parent-Bezug niemals nur aus gleichem Straßennamen inferieren;
- `addr:street` ist Auswahl-/Anzeigehilfe, keine Identity und keine automatische Parent-Autorität;
- der Nutzer kann im Area-Einstieg Houses ohne Parent erzeugen.

### Karteninteraktion

Im neuen `smart-house`-Map-Mode:

- Candidate Houses sichtbar;
- ausgewählte Candidates klar hervorgehoben;
- Tap toggelt einen Candidate;
- kleine Touch-Hitbox im Screen Space;
- bei mehreren tatsächlichen Treffern nicht raten, sondern Treffer explizit auswählbar machen;
- persistierte Houses bleiben als Kontext sichtbar, dürfen Candidate-Taps aber nicht blockieren;
- bestehende Street-Geometrie bleibt lesbar.

### Mehrfachauswahl

Produktanforderung ist Einzel- und Mehrfachauswahl.

Unterstützt werden:

- einzelne Gebäude per Karten-Tap;
- mehrere Gebäude nacheinander;
- optionale Bulk-Auswahl nach vorhandenem `addr:street` als Convenience;
- Auswahl löschen;
- Review vor Persistenz.

Bulk nach Straßenname darf nur passende Gebäude-Candidates markieren. Es erzeugt keinen Street Task und leitet daraus keinen Parent automatisch ab.

## Candidate Renderer

Neue temporäre Source:

`vf-smart-house-candidates`

Kleine feste Layer-Menge, sinngemäß:

- `vf-smart-house-candidates-fill`;
- `vf-smart-house-candidates-outline`;
- `vf-smart-house-candidates-selected`.

Renderer-Regeln:

- keine Layer pro Candidate;
- keine React-/SVG-/Canvas-Projektion pro Candidate;
- Candidate-GeoJSON nur aus dem aktiven Area-Kontext;
- Map Properties minimal, vorzugsweise nur `sourceId` und notwendige Style-Daten;
- Adresse, OSM-Tags und vollständige Candidate-Daten bleiben in Domain-State, nicht unnötig in Map-Properties;
- Candidate-`setData()` nur bei echter Candidate-Mengenänderung;
- Selection möglichst über festen Selected-Layer plus `setFilter()`, damit Tap/Untap nicht Tausende Features neu serialisiert;
- kein `setData()` auf Pan/Zoom/Rotate.

## Hit Testing

Candidate House Hit-Test ausschließlich über MapLibre:

`map.queryRenderedFeatures(...)`

Startwert Mobile-Hitbox:

`±10 px`

Nur der Candidate-Fill-Layer wird für den primären Treffer abgefragt, damit Fill/Outline nicht denselben Candidate mehrfach liefern.

Mehrere unterschiedliche Source-IDs innerhalb der Hitbox werden nicht stillschweigend auf den ersten Treffer reduziert. Der normale Sheet-/Card-Pfad zeigt eine kleine explizite Auswahl.

## Candidate-Dedupe gegen bereits persistierte Houses

Bereits im selben Area persistierte Houses mit derselben aktuellen OSM-Provenance sollen nicht erneut als normal auswählbarer Candidate angeboten werden.

Das ist ausschließlich ein UX-Dedupe anhand vorhandener Provenance und macht die OSM-ID ausdrücklich nicht zur App-Identity.

Keine neue DB-Unique-Constraint auf OSM-ID einführen.

## Persistenz von Mehrfachauswahl

### Problem im aktuellen M5-Modell

`deriveCampaignMutation()` akzeptiert aktuell genau eine neue House-Domainänderung pro Revision. Mehrere House-Adds in einem gebatchten React-Snapshot würden deshalb zu `MutationDerivationError` führen.

Mehrfachauswahl darf nicht durch React-Timing, mehrere unawaited `setState()`-Aufrufe oder einen zweiten Queue-Mechanismus umgangen werden.

### Gewählter Weg: bounded `house.create-batch`

Plan 020 führt eine kleine explizite M5-Mutation für einen einzelnen bestätigten Mehrfachauswahl-Vorgang ein:

`house.create-batch`

Eigenschaften:

- verwendet weiterhin dieselbe M5 IndexedDB Mutation Queue;
- genau eine Campaign-Revision pro bestätigtem Batch;
- atomare Worker-Persistenz;
- keine neue Tabelle und keine neue Migration;
- Einzel-House-`house.create` bleibt unterstützt;
- Batch-Größe zunächst hart auf maximal 50 Houses begrenzen;
- bestehendes allgemeines Mutation-Request-Limit von 256 KB bleibt verbindlich;
- zu große Auswahl wird vor dem Write verständlich zurückgewiesen und kann in mehreren Vorgängen gespeichert werden.

Jedes Batch-Element enthält nur die für `house.create` bereits erlaubten Felder:

- `taskId`;
- `areaId`;
- `label`;
- geprüfte Polygon-Geometrie;
- optionale OSM-Provenance;
- optionaler `parentStreetTaskId`.

Validation muss sicherstellen:

- 1 bis 50 Houses;
- eindeutige Task-IDs im Batch;
- alle Domain-IDs gültig;
- alle Houses gehören zur Ziel-Campaign;
- UI-Vorgang erzeugt Houses für ein Area;
- Parent Street existiert im selben Area oder ist `null`;
- jede Geometrie ist valide;
- jede OSM-Provenance erfüllt den bestehenden House-Vertrag;
- Worker-Autorisierung bleibt maßgeblich.

Persistenz muss vor Migration 0005 vollständig fail-closed bleiben und darf die Campaign-Revision nicht vorab beanspruchen.

## Preview-/Schema-Gate-Hardening

### Aktuell absichtlich nicht ausgerollt

Die Test-/Preview-Umgebung ist dokumentiert nur bis 0003 migriert. Daraus folgt aktuell:

| Modul | Benötigtes Schema | Erwartung vor Rollout |
| --- | --- | --- |
| Smart Street Source Persistenz | 0004 | `schema_migration_required`, keine falsche Erfolgsmeldung |
| House Persistenz | 0005 | `schema_migration_required`, lokale Arbeit nicht als servergespeichert ausgeben |
| Team Hub / Live Field Groups | 0006 | explizites `field_group_schema_unavailable`, kein generischer 500 |
| Einsätze / Activity / Domain Events | 0007 | expliziter Rollout-Hinweis |
| Kommentare | 0008 | expliziter Kommentar-Schema-Hinweis |
| Automationen | 0009 | expliziter Rollout-Hinweis bzw. fail-closed |

Diese Zustände sind kein Grund, die Migrationen in Plan 020 remote anzuwenden.

### Screenshot-Befunde

Vor Plan 019 wurden auf der Testseite unter anderem gesehen:

- Kommentare: `Kommentar-Datenbankmigration ist noch nicht angewendet.`
- Einsätze: Hinweis, dass Migration 0007 noch nicht ausgerollt ist;
- Aktivität: Hinweis, dass Migration 0007 noch nicht ausgerollt ist;
- Team Hub: `Serveranfrage fehlgeschlagen (500).`

Bewertung:

- Kommentar-, Einsatz- und Aktivitätsmeldung entsprechen dem dokumentierten unapplied Schema und sind grundsätzlich erwartbar;
- der generische Team-Hub-500 ist für einen bloß fehlenden 0006-Schema-Stand nicht ausreichend und muss reproduziert bzw. bis zum spezifischen Fail-closed-State gehärtet werden.

### Hardening-Aufgaben

1. Pre-0006-GET für Field Groups mit realistischem D1-Fehler testen.
2. Sicherstellen, dass fehlende `field_groups`/relevante 0006-Spalten als 503 `field_group_schema_unavailable` enden.
3. TeamHub muss diesen Code als verständlichen Rollout-Hinweis darstellen.
4. Keine bekannte Schema-Lücke darf als generischer Infrastruktur-500 maskiert werden.
5. Bestehende 0007-/0008-Gates mit Tests festhalten.
6. Smart-Street-/Smart-House-M5-Schemafehler sollen im Sync-Status nicht fälschlich als erfolgreich gespeichert erscheinen.
7. Cloudflare-Preview darf zur Verifikation gelesen werden, aber kein manueller Deploy und keine Remote-Migration aus diesem Plan.

UNKLAR: Falls der Team-Hub-500 nicht aus fehlendem 0006-Schema, sondern aus einem Preview-Binding-/Worker-Konfigurationsfehler stammt, Ursache exakt dokumentieren und den kleinsten sicheren Fix wählen. Nicht durch eine Migration kaschieren.

## Bounded UI statt Candidate-DOM-Flut

`SmartHouseSelectionPanel` wird für den normalen Produktweg angepasst statt blind mit allen Gebäuden gerendert.

Regeln:

- Karte ist primäre Auswahlfläche;
- DOM zeigt ausgewählte Houses und kontrollierte Hilfsaktionen, nicht zwingend jedes Candidate-Gebäude gleichzeitig;
- Selected-Liste ist durch den Batch-Maximalwert gebunden;
- Straßen-Bulk-Auswahl verwendet eine such-/filterbare, gebundene Darstellung ohne neue UI-Library;
- keine Virtualization-Library einführen, solange native begrenzte Darstellung reicht.

## Offline-/Retry-Verhalten

Candidate-Daten kommen aus dem bestehenden vorbereiteten IndexedDB-Paket und sind deshalb auch bei fehlendem Netz verfügbar.

House-Persistenz nutzt ausschließlich M5:

- online: normale Queue/Worker-Verarbeitung;
- offline: lokal persistent und als offline/pending gekennzeichnet;
- Retry: dieselbe Mutation-ID, kein doppeltes House-Batch;
- Konflikt: bestehender M5-Konfliktpfad;
- Auth verloren: blocked-auth wie bisher;
- Schema fehlt: kein falsches `gespeichert` behaupten.

Kein zweiter Queue- oder Background-Sync-Mechanismus.

## Security / Privacy

Verbindlich:

- Worker bleibt authoritative Authorization Boundary;
- Admin bzw. passender Team Editor darf Houses erzeugen;
- temporäre Field-Group-Mitglieder erhalten dadurch keine neue Create-Berechtigung;
- OSM-IDs und Source-IDs sind Selektoren/Provenance, keine Credentials;
- OSM-Adress-Tags bleiben inert und werden niemals als HTML interpretiert;
- keine Secrets, Tokens, Cookies, Session-Hashes oder QR-Credentials in Map-Properties oder Logs;
- keine GPS-Historie;
- keine neue Permission-/Identity-Runtime;
- D1 nur mit gebundenen/parametrisierten Statements.

## Performance / Dense House

Mindestens prüfen:

- 1.000 Building Candidates;
- 5.000 Building Candidates;
- 10.000 Building Candidates;
- 20.000 Building Candidates.

Invarianten:

- 0 React-DOM-Nodes pro Candidate im Kartenmodus;
- 0 MapLibre-Layer pro Candidate;
- keine `map.project()`-Schleife pro Candidate bei Kamerabewegung;
- Candidate-`setData()` nicht auf Pan/Zoom/Rotate;
- Selection bevorzugt Filter-Update statt vollständigem Candidate-`setData()`;
- persistierter `vf-houses`-Renderer bleibt unabhängig;
- Batch UI bleibt auf maximal 50 ausgewählte Houses pro Save-Vorgang begrenzt.

Messen bzw. manuell prüfen:

- Eintritt in Smart House Mode;
- initiale Candidate-Serialisierung;
- Tap-Latenz;
- Mehrfachauswahl;
- Pan/Zoom/Rotate;
- Abbruch;
- Save eines typischen Batches;
- Memory/Long Frames.

## Mobile / Accessibility

Automatisiert und soweit möglich im Browser prüfen:

- Touch-Hitbox;
- überlappende Gebäude;
- klare Candidate-/Selected-Darstellung;
- großer Daumen-Tap;
- Cancel/Zurück;
- Tastatur-/Screenreader-erreichbare Alternative für die Auswahl;
- keine Hover-only-Funktion.

Reale Android-Chromium- und iPhone-Safari-Abnahme bleibt ein explizites offenes Quality-Gate, solange keine echten Geräte benutzt wurden. Sie umfasst weiterhin den finalen `HOUSE_MIN_ZOOM`, House-Dichte und den gesamten Smart-Street-/Smart-House-Weg.

## Erwartete Dateien

Primärer Runtime-Slice wahrscheinlich:

- `src/App.tsx`;
- `src/map/MapView.tsx`;
- `src/map/SmartHouseSelectionPanel.tsx`;
- `src/domain/mutations.ts`;
- `src/domain/mutationDiff.ts`;
- `worker/mutationValidation.ts`;
- `worker/mutationRepository.ts`;
- `src/i18n.ts`;
- neue gezielte Smart-House-Runtime-/Batch-Tests.

Schema-Gate-Hardening nur soweit durch Reproduktion notwendig, wahrscheinlich:

- `worker/fieldGroups.ts`;
- `src/team/TeamHub.tsx`;
- Field-Group-/UI-Regressionstests;
- ggf. Sync-Fehlermapping für `schema_migration_required`.

Keine allgemeine Renderer-, Queue- oder API-Abstraktion allein für diesen Slice erstellen.

## Umsetzungsschritte

### Checkpoint 0: Source of Truth und Preview-Befunde

- lokalen Working Tree prüfen;
- PR #72, Base/Head/Draft/Mergeability prüfen;
- CI auf exakt aktuellem Head prüfen;
- dokumentierten Remote-Migrationsstand prüfen;
- Screenshot-/Schema-Matrix gegen aktuellen Code reproduzieren;
- Team-Hub-500 klassifizieren.

### Checkpoint 1: Smart-House-Domain-State im normalen App-Flow

- `smart-house` Map Mode ergänzen;
- Building Candidates aus `smartCandidatesForArea()` verwenden;
- Area-/optional Street-Einstieg ergänzen;
- Selected State, Parent-Kontext und Cancel/Reset sauber modellieren.

### Checkpoint 2: MapLibre Candidate Renderer und Hit-Test

- `vf-smart-house-candidates` plus feste Layer;
- Candidate-Daten und Selection-Filter trennen;
- `queryRenderedFeatures` Tap-Hit-Test;
- Mehrfachtreffer explizit behandeln;
- bestehende `vf-houses`-/Street-Layer nicht regressieren.

### Checkpoint 3: Bounded Mobile Selection UI

- bestehende Smart-House-Foundation produktionsgeeignet machen;
- Einzel-/Mehrfachauswahl;
- Bulk nach `addr:street` als Convenience;
- ausgewählte Houses reviewbar;
- Candidate-DOM begrenzen.

### Checkpoint 4: Bounded House Batch Mutation

- `house.create-batch` Domain-Typ;
- Derivation;
- Apply;
- Validation;
- Authorization;
- atomare D1-Persistenz;
- Fingerprint/Idempotenz;
- pre-0005 Fail-closed;
- max. 50 Houses und 256-KB-Grenze.

### Checkpoint 5: Normaler Persistenz-/Renderer-Abschluss

- bestätigte Candidates in HouseTask-Snapshots umwandeln;
- bestehende M5 Queue verwenden;
- Saved Houses erscheinen über `vf-houses`;
- bereits persistierte Candidate-Provenance nicht erneut normal anbieten;
- Parent Street nur explizit setzen.

### Checkpoint 6: Preview-/Schema-Gate-Hardening

- Team-Hub-500 reproduzieren und klassifizieren;
- known missing schema -> spezifischer 503/UI-Hinweis;
- 0007-/0008-Gates regressionssicher;
- Smart Street/House Schema-Gates im Sync klar;
- keine Migration remote anwenden.

### Checkpoint 7: Dense Data und Browser

- 1k/5k/10k/20k Building Candidate Tests/Profiling;
- Touch-Hit-Test;
- Pan/Zoom/Rotate;
- Selection Filter;
- Batch Save;
- keine falsche reale Geräteabnahme behaupten.

### Checkpoint 8: Quality und Living Docs

- relevante Tests;
- TypeScript;
- Dependency Audit;
- Production Build;
- `npm run check`;
- `CURRENT.md` und Context Graph aktualisieren;
- Plan nach echtem Abschluss nach `docs/plans/completed/` verschieben;
- finalen GitHub-Head und CI auf exakt diesem Head verifizieren.

## Tests

Mindestens bestehend:

- `tests/smartCandidates.test.ts`;
- `tests/smartBuildingSelection.test.ts`;
- `tests/housePersistence.test.ts`;
- `tests/houseParentCascade.test.ts`;
- `tests/houseRenderer.test.ts`;
- `tests/snapshotValidation.test.ts`;
- `tests/mutationDiff.test.ts`;
- `tests/mutationQueue.test.ts`;
- `tests/fieldGroups.test.ts`;
- `tests/platformLauncher.test.ts`;
- `tests/securityStaticGuards.test.ts`.

Neu/erweitert mindestens:

- normaler Smart-House-Produktgraph ohne Workbench/Mock;
- Candidate Source/Layer konstant;
- House Map Hit-Test;
- Toggle und Mehrfachtreffer;
- Bulk `addr:street`;
- expliziter Parent Street;
- no-package/no-candidate;
- Cancel ohne Mutation;
- bereits persistierter OSM-Candidate deduped;
- `house.create-batch` 1/mehrere/max-50;
- Duplicate IDs im Batch abgelehnt;
- Parent in falschem Area abgelehnt;
- pre-0005 Batch fail-closed ohne Revisionsclaim;
- Batch idempotenter Retry;
- Worker-Autorisierung für Admin/Team Editor;
- Viewer/temporary member create forbidden;
- pre-0006 Field Group GET ergibt spezifischen Schema-Gate-State statt generischem 500;
- bestehende 0007-/0008-Schema-Gates bleiben spezifisch.

## Quality Gates

Vor Abschluss:

```bash
npm test
npm run typecheck
npm run audit:dependencies
npm run build
npm run check
```

Anschließend GitHub:

- finalen exakten Branch-Head prüfen;
- PR #72 weiterhin offen/Draft;
- Mergeability prüfen;
- CI nur akzeptieren, wenn sie auf exakt diesem finalen Head grün ist.

## Risiken

### Zu viele Candidate-DOM-Nodes

Mit MapLibre + bounded Panel verhindern. Keine große unvirtualisierte Komplettliste.

### Mehrfachauswahl kollidiert mit M5-Einzelmutation

Nicht mit React-Timing umgehen. Bounded Batch als echte M5-Mutation modellieren.

### OSM-Straßenname wird als Parent missverstanden

Nicht automatisch inferieren. Parent nur durch expliziten Street-Kontext/Bestätigung.

### Preview-Migrationsfehler werden als Produktdefekt fehlinterpretiert

Schema-Matrix dokumentieren und spezifische fail-closed Fehlerzustände testen.

### Generischer Team-Hub-500 hat andere Ursache

Erst reproduzieren. Binding-/Worker-/Schemafehler unterscheiden. Keine Migration als Diagnosewerkzeug anwenden.

## Nicht-Ziele

Nicht Teil von Plan 020:

- Remote-Anwendung von Migration 0004 bis 0009;
- manueller Cloudflare-Deploy;
- Merge oder Ready-for-Review von PR #72;
- neuer Branch oder neuer PR;
- neue OSM-Abfrageengine;
- OSM-ID als App-Identity;
- automatische Parent-Zuordnung nur über Straßennamen;
- House-Reconciliation nach OSM-Refresh;
- Pickup-/Collection-House-Modell;
- Organization-/Account-/Permission-Runtime;
- Service Worker, PWA oder Background Sync;
- GPS-Historie;
- AI-/LLM-Routing.

## Abschlusskriterium

Plan 020 ist erst abgeschlossen, wenn ein berechtigter Nutzer im normalen Produkt echte vorbereitete Gebäude auf MapLibre auswählen, einzeln oder in einem bounded Mehrfachvorgang reviewen und über M5 als persistierte House Tasks erzeugen kann, diese danach durch `vf-houses` sichtbar sind und bekannte unapplied Schema-Stände auf der Testseite spezifisch fail-closed statt irreführend als generische Produktfehler erscheinen.

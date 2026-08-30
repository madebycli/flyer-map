---
id: plan-021-collection-pickup-persistence
type: plan
status: active
last_updated: 2026-08-30
related: [plan-feature-complete-platform, plan-smart-street-runtime, plan-smart-house-runtime, plan-platform-expansion, product-roadmap, product-ux, map, data, offline-sync, security, collaboration, adr-offline-map-data, adr-smart-task-identity, adr-field-session-events, adr-action-templates-analytics, quality]
source_of_truth_for: [fc5-collection-pickup-persistence-decision]
---

# Plan 021: Collection / Pickup Persistenz

## Ziel

Dieser Plan bereitet den nächsten Feature-Complete-Slice FC5 Collection / Pickup vor. Er
entscheidet noch keine Runtime-Implementierung und führt in diesem Turn weder eine
Pickup-Migration noch Pickup-Code aus.

Der aktuelle Repository-Stand zeigt eine kleine Pickup-Domain-Foundation, aber noch
keinen normalen Produktweg:

- src/domain/pickup.ts kennt die Status open, collected, unavailable und
  needs-follow-up, validiert eine manuelle Adresse und berechnet einen eigenen Nenner;
- src/collection/PickupPanel.tsx ist eine isolierte Callback-UI und wird von App,
  PlatformShell oder MapView nicht importiert;
- CampaignSnapshot kennt nur Street Tasks und die additive House-Task-Collection;
- die M5-Mutation, Worker-Persistenz, D1-Tabelle, MapLibre-Interaktion und
  Collection-Stats für Pickup fehlen;
- Collection-Field-Groups und Collection-Field-Sessions sind als Grundlagen bereits
  vorbereitet, dürfen aber nicht als Pickup-Persistenz missverstanden werden;
- Workbench-Collection-Daten und ActionTemplate-Pickup-Platzhalter sind kein normaler
  Produktweg.

Ziel ist ein belastbarer Architekturentscheid zwischen einer eigenständigen Pickup-
Persistenz und einer gekoppelten Collection-Erweiterung bestehender Distribution Tasks.
Die Entscheidung muss später die getrennten Status, stabile App-Identität,
Worker-Autorisierung, M5-Retry, Field Sessions, MapLibre und separate Stats tragen.

## Anforderungen

### Verifizierte technische Baseline

Zum Planungsbeginn wurden lokal und gegen GitHub geprüft:

- Repository madebycli/flyer-map;
- Branch plan-feature-complete-platform;
- PR #72 FC0-FC2: Platform, Live Field Groups and Field Sessions;
- Base ui-app-launcher-sheet;
- Head 7c38830cbf94129ff4cb3e1a97ab73fd9b5a605c;
- PR offen, Draft, mergeable und nicht gemerged;
- CI #712 ist auf exakt diesem Head erfolgreich mit Tests, TypeScript,
  Dependency Audit und Production Build;
- Plan 018, 019 und 020 liegen unter docs/plans/completed/;
- der redundante Launcher-Eintrag Karte ist entfernt;
- Remote-D1 ist weiterhin nur bis 0001 bis 0003 dokumentiert;
- Migrationen 0004 bis 0009 sind vorbereitet, aber nicht remote angewendet.

Die lokalen uncommitted Änderungen gehören zum vorhandenen Arbeitskontext und wurden
nicht zurückgesetzt, überschrieben oder verworfen. Dieser Planungscommit verändert
keine Runtime-Datei.

### Fachliche Anforderungen

- Distribution und Collection sind explizite, visuell unterscheidbare Betriebsmodi.
- Ein Pickup-Status darf niemals den Status eines Street- oder House-Distribution-Tasks
  überschreiben.
- Pickup Tasks brauchen eine stabile app-eigene Identität. OSM-Way-IDs bleiben nur
  Provenance oder Auswahlreferenz.
- Ein Pickup Task muss aus einem bestehenden Street-/House-Kontext entstehen können,
  darf aber auch als manuelle Meldeadresse ohne Distribution House möglich sein.
- Adresse, Notiz und geprüfte Geometrie werden als inert gespeicherte Daten behandelt.
- Reale vorbereitete OSM-Gebäude dürfen als Kandidaten dienen, aber es darf keine
  zweite OSM-Abfrageengine und keine Fake-/Preview-Daten im Produktgraphen geben.
- Collection-Road-Abschnitte brauchen einen eigenen Status und dürfen nicht über den
  Distribution-Status einer Straße simuliert werden, solange die Granularität nicht
  ausdrücklich entschieden ist.
- Berechtigung wird für jeden Read und Write serverseitig durch den Worker geprüft.
- Offline-/Retry-Verhalten verwendet ausschließlich die vorhandene M5-IndexedDB-Queue,
  dieselbe Mutation-Id und denselben Idempotenzpfad.
- MapLibre bleibt die einzige Kartenengine. Candidate- und gespeicherte Pickup-
  Geometrien werden gebatcht über eine konstante kleine Zahl von Sources/Layern
  dargestellt.
- Collection-Field-Groups dürfen nur mit einer später festgelegten, serverseitig
  geprüften Capability im Collection-Scope arbeiten.
- Collection-Field-Sessions und Domain Events bleiben von Distribution-Metriken
  unterscheidbar.
- Collection-Stats verwenden benannte eigene Nenner, insbesondere pickup-tasks und
  collection-road-sections, und werden nicht in Street-/House-Distribution-Stats
  eingerechnet.

### Verbindliche Grenzen dieses Turns

- keine Collection-/Pickup-Runtime;
- keine neue Migration remote;
- kein expliziter Deploy;
- kein Merge und kein Ready for Review für PR #72;
- kein neuer Branch und kein neuer PR;
- keine neue Dependency, kein Service Worker, keine PWA, kein Background Sync;
- keine GPS-Historie, keine neue Identity-/Permission-Runtime und kein AI-/LLM-Routing.

## Architektur (gewählter Ansatz)

UNKLAR: Architekturentscheidung durch Master ausstehend.

Die folgende Empfehlung ist eine Entscheidungsgrundlage. Sie ist nicht als akzeptierte
Architektur zu behandeln. Vor Runtime-Code müssen Master und das Repository den Ansatz
und die markierten offenen Fragen festlegen.

### Ansatz A: First-Class pickup_tasks

Pickup wird als eigene persistente Collection-Entität modelliert. Das ist die bevorzugte
Richtung für die weitere Umsetzung, aber noch nicht von Master entschieden.

Vorgesehene Grundform:

- additive D1-Tabelle pickup_tasks mit app-eigener ID, campaign_id und eigenem Status;
- optionale CampaignSnapshot.pickupTasks als rückwärtskompatible Read-/Cache-Collection,
  sofern der Snapshot weiterhin der UI-Vertrag für aktuelle Campaign-Daten bleibt;
- eigene Adress-/Notiz- und Geometrie-Snapshots;
- optionale OSM-Provenance als genau geprüfte, nicht geheime Metadaten;
- explizite, optionale Referenzen auf Distribution Street/House, ohne deren Lifecycle
  oder Status zu übernehmen;
- eine manuelle Call-in-Adresse kann auch ohne Distribution House angelegt werden;
- pickup.create, pickup.set-status, pickup.rename und pickup.delete als eigene
  M5-Mutationen, nicht als task.set-status;
- Worker-Validation und Worker-Autorisierung auf Pickup-Scope;
- eigene Collection-Events wie pickup.status.changed;
- eigene MapLibre-Pickup-Source und feste Status-Layer;
- eigene Pickup-Progress-Projektion.

Für den empfohlenen Datenvertrag sind folgende Eigenschaften vorgesehen, vorbehaltlich
der offenen Fragen:

- Campaign-Scope ist mindestens erforderlich;
- Area-/Team-Scope wird entweder verpflichtend für Feldarbeit oder als nullable
  Intake-Scope für Admins modelliert;
- der effektive Team-Scope wird aus einem gültigen Area-Kontext abgeleitet oder
  serverseitig explizit geprüft, statt doppelte, driftende Zuordnung zu speichern;
- eine kopierte Address-/Geometry-Snapshot bleibt die authoritative Collection-Datenbasis;
- eine optionale Distribution-House-Referenz dient nur der Nachvollziehbarkeit;
- bei direkter OSM-Gebäudeauswahl bleibt die OSM-Way-ID Provenance und niemals die
  Pickup-ID;
- eine manuelle Adresse ohne Koordinaten bleibt zunächst listenfähig, falls Master
  keine Kartenposition verlangt. Sie wird nicht durch ungeprüftes Geocoding
  künstlich auf die Karte gesetzt.

Straßenabschnitte werden unter Ansatz A nicht als Distribution Task umetikettiert.
Wenn sie im selben FC5-Produktweg persistiert werden, ist eine separate
collection-road-section-Entität mit eigener app-eigener ID, LineString-Snapshot,
Collection-Scope und eigenem Status die konsistente Erweiterung. Ob sie im ersten
FC5-Implementierungsslice oder unmittelbar danach folgt, bleibt von der Granularitäts-
entscheidung abhängig.

### Ansatz B: Collection-State auf Distribution Tasks plus manuelle Pickup Tasks

Bestehende Street-/House-Distribution-Tasks erhalten zusätzliche Collection-Felder
oder eine zusätzliche Collection-Statusstruktur. Nur manuelle Call-in-Adressen werden
in einer separaten Pickup-Entität gespeichert.

Vorgesehene Folgen:

- Migrationen und Snapshot-/M5-Verträge müssen Street und House um einen zweiten,
  unabhängigen Collection-State erweitern;
- Collection-Statusänderungen brauchen trotzdem explizite Mutationstypen, damit
  task.set-status nur Distribution betrifft;
- eine Collection kann die bestehende Street-/House-Geometrie wiederverwenden;
- manuelle Adressen bilden eine zweite Persistenzform mit eigener Identität und eigenen
  Lifecycle-Regeln;
- Field-Session- und Event-Projektionen müssen Distribution-Task-Ziele und manuelle
  Pickup-Ziele zusammenführen, ohne ihre Lebenszyklen zu vermischen;
- Collection-Road-Abschnitte sind nur dann ausreichend modelliert, wenn sie exakt den
  Distribution-Street-Tasks entsprechen. Eigene Collection-Teams, kleinere Areas oder
  abweichende Fahrabschnitte benötigen trotzdem zusätzliche Entitäten;
- Delete, Archive, Referenzen und Stats werden dadurch zu einer Mischform aus
  Distribution-Tabellen und Pickup-Tabelle.

Dieser Ansatz wirkt für den ersten gemeinsamen Hausfall kleiner, koppelt aber die
Collection an eine Distribution-Datenstruktur, die nach ADR-0018 als vorgeschlagene
Richtung gerade nicht zwingend dieselben Teams und Areas verwenden soll.

### Vergleich

| Kriterium | A: first-class pickup_tasks | B: Collection-State auf Distribution plus manuelle Pickup Tasks |
| --- | --- | --- |
| Implementierungskomplexität | Mittel bis hoch am Anfang, ein klarer eigener Vertrag | Niedriger für den ersten Hausfall, steigt durch zwei Formen und Sonderpfade |
| Datenmodell-Klarheit | Hoch, Pickup ist eine eigene Collection-Entität | Niedrig bis mittel, zwei Status-/Persistenzmodelle müssen zusammen erklärt werden |
| Distribution/Collection-Trennung | Hoch, getrennte Tabellen, Mutationen und Status | Mittel bis niedrig, Kopplung bleibt in Street/House-Tabellen |
| M5-Kompatibilität | Mittel, neue explizite Mutationen im vorhandenen Queue-Pfad | Mittel bis hoch, zusätzliche Collection-Felder und zwei Zielarten |
| Offline-/Retry-Verhalten | Mittel, ein Pickup-Vertrag plus bekannte Queue-Semantik | Hoch, Wiederholung muss zwei Persistenzformen und Referenzen korrekt behandeln |
| Worker-Autorisierung | Mittel, ein expliziter Pickup-Scope | Hoch, Worker muss Distribution-Ziel, Collection-State und manuelle Pickup trennen |
| Field Sessions / Events | Hoch, Collection-Ziele und Eventtypen sind sauber allowlistbar | Mittel bis niedrig, Projektion muss gemischte Zieltypen auswerten |
| MapLibre-Wiederverwendung | Hoch, gleiche Engine mit eigener gebatchter Pickup-Source | Hoch im einfachen Fall, aber zusätzliche Pfade für manuelle Pickup-Geometrie |
| Manuelle Call-in-Adressen | Hoch, natürlicher First-Class-Fall | Mittel, Sonderentität neben Distribution-State |
| Street-/House-Lifecycle | Hoch, Collection überlebt Distribution-Lifecycle nach eigener Regel | Niedrig, Archive/Delete und Status hängen am Distribution-Lifecycle |
| Spätere Organizations | Hoch, Campaign-/später Action-Scope kann sauber erweitert werden | Niedrig bis mittel, Collection-Teams/Areas bleiben an Distribution gekoppelt |
| Dense-Mobile-Performance | Mittel, eine zusätzliche gebatchte Quelle und feste Layer | Mittel, mehrere Quellen und Statuspfade, aber gleiche MapLibre-Basis |
| Sicherheitsrisiko | Niedriger, Status und Autorisierung sind explizit getrennt | Höher, Verwechslung von Status und Scope ist wahrscheinlicher |
| D1-Speicher/Kosten | Mittel, eigene Zeilen und Snapshots, aber keine Doppelstatusspalten | Niedriger am Anfang, später Zusatzspalten, Sondertabelle und komplexere Reads |
| Spätere Wartung | Niedriger, Collection kann unabhängig wachsen | Höher, jede Distribution-Änderung muss Collection-Folgen prüfen |

### Empfehlung für Master

Empfohlen wird Ansatz A, zunächst mit einer kleinen First-Class-Pickup-Entität und
expliziten Pickup-Mutationen im bestehenden M5-Pfad. Gründe:

1. Der wichtigste Produktgrundsatz, Distribution und Collection niemals gegenseitig
   zu überschreiben, wird im Datenmodell sichtbar und serverseitig erzwingbar.
2. Manuelle Meldeadressen sind kein Sonderfall neben einem Distribution Task, sondern
   ein gültiger eigener Collection-Startpunkt.
3. Die vorgeschlagene spätere Action-/Template-Richtung erlaubt Collection mit anderen
   Teams und Areas. Ansatz A schließt diese Erweiterung weniger ein.
4. Field Sessions, Events und Stats können Collection als eigenen Modus und eigenen
   Zieltyp allowlisten, ohne Distribution-Status zu reinterpretieren.
5. MapLibre, IndexedDB, Worker und D1 bleiben dieselben vorhandenen Infrastrukturpfade.

Die Empfehlung akzeptiert noch nicht die Detailfragen Area-/Team-Pflicht,
Distribution-House-Referenz versus Snapshot, Road-Section-Tabelle oder die spätere
Action-Zuordnung. Diese müssen vor dem ersten Runtime-Commit entschieden werden.

## Dateistruktur

### Erste drei Dateien

Die ersten drei Leitdateien für den späteren Implementierungsstart sind:

1. migrations/0010_fc5_pickup_tasks.sql, neue additive Pickup-Tabelle mit kleinen
   Indizes, Status-Checks und den nach der Architekturentscheidung bestätigten
   Referenzen;
2. src/domain/pickup.ts, bestehende Foundation zu PickupTask, Identität, Status-,
   Adress-/Geometrie-/Provenance-Validierung und Progress-Vertrag ausbauen;
3. src/domain/mutations.ts, explizite pickup.*-M5-Mutationen mit stabilen IDs,
   Konfliktfeldern und ohne Wiederverwendung von Distribution task.set-status.

Die unmittelbar gekoppelte Folgedatei src/domain/campaign.ts muss den aktuellen
Snapshot-Vertrag um die bestätigte optionale Pickup-Collection ergänzen. Sie ist
bewusst als nächster abhängiger Schritt dokumentiert und nicht durch eine neue
generische Domain-Abstraktion ersetzt.

### Weitere betroffene Dateien

Nach den drei Leitdateien sind anhand der bestehenden Struktur voraussichtlich zu
prüfen oder zu ändern:

- worker/campaignRepository.ts und worker/snapshotValidation.ts für Reads, Snapshot-
  Kompatibilität und Schema-Gate;
- worker/mutationValidation.ts, worker/mutationHandler.ts, worker/mutationRepository.ts
  und worker/authorization.ts für Validierung, Worker-Scope und atomare D1-Writes;
- worker/mutationEvents.ts für Collection-Task-Events und die vorhandene Session-
  Zuordnung;
- src/data/campaignStore.ts, src/data/campaignApi.ts und src/data/mutationQueue.ts für
  den bestehenden M5-Offline-/Retry-/Schema-Fehlerpfad;
- src/App.tsx und src/platform/PlatformShell.tsx für den normalen expliziten
  Collection-Modus, Area-/Task-Einstieg und Launcher-Zugriff;
- src/map/MapView.tsx und eine kleine Collection-Map-Datenserialisierung für feste
  Pickup-/Road-Section-Sources, Hit-Test und getrennte setData-/setFilter-Pfade;
- src/collection/PickupPanel.tsx und die bestehende CSS-Datei, sobald die UI an den
  echten Snapshot-/Mutation-Flow angeschlossen wird;
- worker/index.ts oder worker/indexM55.ts nur für die vorhandenen geschützten
  Collection-Routen, nicht als zweiter Worker;
- worker/fieldSessions.ts, worker/fieldSessionTasks.ts, worker/statistics.ts,
  src/domain/statistics.ts und die Collaboration-UI für Collection-Scope und getrennte
  Nenner;
- worker/comments.ts, wenn Pickup-Kommentare fachlich freigegeben werden. Der aktuelle
  Code lehnt targetType pickup bewusst ab;
- gezielte Tests unter tests/ für Domain, Persistence, Authorization, Queue, Events,
  MapLibre-Vertrag, Stats und mobile UI.

Workbench-Dateien wie src/workbench/M6SelectionPreview.tsx und
src/workbench/ActionWorkbenchPreview.tsx bleiben Entwicklungs-/Prüfmaterial. Ihre
Preview-/Mock-Daten dürfen nicht in den normalen Produktgraphen kopiert werden.

## Umsetzungsschritte

Die Reihenfolge ist ein späterer Ausführungsplan, kein bereits akzeptierter
Runtime-Auftrag:

1. Domain- und Identity-Vertrag: Ansatz A oder B sowie App-ID-Präfix,
   Campaign-/Area-/Team-Scope, Geometrieform, Provenance und Distribution-Referenzen
   durch Master festlegen. Für den gewählten Architekturentscheid einen neuen
   akzeptierten ADR-Knoten erstellen, bevor die Persistenz irreversibel wird.
2. Additive D1-Persistenz: nach der Entscheidung Migration 0010 klein halten, eigene
   Status-Checks/Indizes und Foreign-Key-/ON DELETE-Semantik festlegen. Ein fehlendes
   Schema führt spezifisch und fail-closed zu schema_migration_required, ohne vorherigen
   Revisionsclaim.
3. Pickup-M5-Mutationen: create, status change und die nötigen Rename-/Delete-
   Operationen als explizite CampaignMutation-Typen modellieren. Die vorhandene
   IndexedDB-Queue, Fingerprint-/Mutation-ID-Idempotenz und Konfliktlogik bleiben
   unverändert wiederverwendet.
4. Worker-Validation und Authorization: IDs, Text, Status, Geometry, Provenance,
   Referenzen, Scope und Request-Größe validieren. Admin, Team Editor und temporäre
   Collection-Field-Group-Mitglieder erhalten nur die später bestätigten Aktionen.
   Viewer bleibt read-only. Der Worker prüft jeden Retry erneut.
5. Snapshot-/Repository-Vertrag: pickupTasks nur bei vorhandenem Schema laden,
   ältere lokale Snapshots weiter akzeptieren und beim Delete-/Archive-Lifecycle die
   beschlossene Unabhängigkeit von Distribution berücksichtigen.
6. Offline-/Retry-Verhalten: online, offline, retry, conflict, blocked-auth,
   invalid und schema_migration_required durch den vorhandenen M5-Status darstellen.
   Duplicate Submit und idempotenter Batch-/Einzel-Retry dürfen keine doppelte
   Pickup-Entität oder ein doppeltes Event erzeugen.
7. Normaler Collection-Modus: explizite Mode-Anzeige und Zugriff aus dem bestehenden
   Sheet-/Launcher-System herstellen. Keine geplante AppMenu- oder Workbench-UI als
   fertige Funktion ausgeben. Area-/Team-Scope und leere/fehlerhafte Zustände sichtbar
   machen.
8. MapLibre Collection-Rendering und Interaktion: reale vorbereitete OSM-Buildings
   oder geprüfte bestehende House-Kontexte verwenden, manuelle Adressen als
   list-only oder ausdrücklich positionierte Geometrie behandeln und keine neue
   Geocoding-API voraussetzen. Pickup- und Collection-Road-Sources mit wenigen festen
   Layern, großen Touch-Hitboxen und klarer Statusdarstellung integrieren.
9. Collection-Road-Sections: nach der offenen Granularitätsentscheidung gefahrene
   und fertige Abschnitte mit eigener stabiler Identität, eigener Persistenz und
   eigener Event-/Stats-Projektion umsetzen. Falls sie nicht Teil desselben Slices
   sind, den Übergang als expliziten Folgeslice dokumentieren.
10. Field Sessions und Events: Collection-Sessions bleiben mode=collection.
    Autoritativ angewendete Pickup-/Road-Statusmutationen verknüpfen sich mit der
    passenden Session. Events enthalten nur minimale Ziel-/Statusdaten, keine Notizen,
    Credentials, Cookies, GPS oder freien Request-Body.
11. Collection Stats: Pickup-Progress aus persistierten Pickup Tasks, Road-Progress aus
    persistierten Collection Road Sections und Sessions aus field_sessions ableiten.
    Denominator pickup-tasks beziehungsweise collection-road-sections immer anzeigen.
    Keine Rollup-Tabelle ohne gemessenen Bedarf.
12. Dense-Mobile und echte Geräte: Candidate-/Pickup-Daten in repräsentativer Dichte
    prüfen, feste MapLibre-Layer und 0 Candidate-DOM-Nodes sicherstellen, Pan/Zoom/
    Rotate ohne React-Projektion testen und Android Chromium/iPhone Safari nicht
    durch Cloud-Browser-Ergebnisse ersetzen.
13. Living Docs und Rollout-Gates: DATA, OFFLINE_SYNC, MAP, SECURITY, COLLABORATION,
    ROADMAP, UX, CURRENT und Context Graph aktualisieren. Migration 0010 separat und
    ausdrücklich ausrollen, erst danach den Schema-Gate-Zustand als produktiv
    bezeichnen.

## Tests und Quality Gates

### Bestehende Tests als Baseline

Nach einem späteren Runtime-Slice sind mindestens diese vorhandenen Tests erneut zu
prüfen:

- tests/pickup.test.ts;
- tests/actionTemplate.test.ts und tests/newActionSetup.test.ts, damit Workbench-
  Collection-Verträge nicht als Produkt-Persistenz ausgegeben werden;
- tests/fieldGroups.test.ts, tests/fieldSessions.test.ts und
  tests/fieldSessionTasks.test.ts für den bereits vorbereiteten Collection-Modus;
- tests/mutationDiff.test.ts, tests/mutations.test.ts, tests/mutationQueue.test.ts,
  tests/mutationQueueStates.test.ts, tests/mutationRepository.test.ts und
  tests/mutationEventPersistence.test.ts;
- tests/comments.test.ts, falls Pickup-Kommentare ausdrücklich zugelassen werden;
- tests/statistics.test.ts und tests/statisticsUi.test.ts;
- tests/securityStaticGuards.test.ts, tests/mutationSqlSafety.test.ts und
  tests/snapshotValidation.test.ts.

### Neue gezielte Tests

Ein späterer Implementierungs-Slice muss mindestens abdecken:

- app-eigene Pickup-ID, OSM nur Provenance und keine OSM-ID als Primärschlüssel;
- manuelle Adresse mit HTML-, SQL- und JavaScript-ähnlichem Text bleibt inert;
- OSM-Gebäude-Candidate kann ohne vorhandenen Distribution House nur dann angelegt
  werden, wenn dies explizit entschieden und serverseitig erlaubt ist;
- Referenz, kopierter Adress-/Geometrie-Snapshot und Distribution-Delete folgen der
  festgelegten Lifecycle-Regel;
- open, collected, unavailable und needs-follow-up ändern nur Pickup-State;
- eindeutige Einzel- und Mehrfach-Create-Operation, Duplicate Submit und idempotenter
  Retry;
- Start/Cancel und leere Kandidaten erzeugen keine Mutation;
- Area-/Team-/Campaign-Fremdzugriff, Viewer, Team Editor, Admin und temporäres
  Collection-Mitglied werden negativ und positiv geprüft;
- Offline, Retry, 401/403, Konflikt und fehlende Migration bleiben im vorhandenen
  M5-Pfad und melden keinen falschen Erfolg;
- Worker-D1-Statements bleiben gebunden, der Write claimt keine Revision vor einem
  fehlenden Pickup-Schema und Events werden bei Replay nicht dupliziert;
- Collection-Events enthalten keine Secrets, Tokens, Cookies, Session-Hashes, GPS,
  freien Notizen oder vollständigen Snapshots;
- Collection-Field-Session wird von Distribution-Session getrennt, Stats mischen
  keine Nenner und Pickup-Zahlen stammen aus persistierter Source of Truth;
- MapLibre verwendet konstante Source-/Layer-Zahlen, Fill-/Line-Hit-Test statt
  Candidate-DOM und keine per-Feature-React-/SVG-/Canvas-Projektion;
- normaler Produktionsgraph referenziert keine PREVIEW_ROADS, Mock Roads,
  PREVIEW_BUILDINGS oder Workbench-Daten;
- mobile Touch-Ziele, Tastatur-/Screenreader-Alternative, Cancel und
  statusabhängige Darstellung funktionieren ohne Hover.

### Quality Commands

Für den späteren Runtime-Commit gelten:

- npm test;
- npm run typecheck;
- npm run audit:dependencies;
- npm run build;
- npm run check.

Dieser Turn ist ausschließlich Planung und Dokumentation. Es wurde keine Pickup-
Runtime verändert. Der Dokumentationscommit muss dennoch auf einem neuen exakten
GitHub-Head geprüft werden; ein älterer grüner Head zählt nicht als Nachweis für einen
neueren Head. Ein Browser-Smoke-Test ist für diesen Dokumentationscommit nicht
fachlich erforderlich, weil sich der normale Runtime-Graph nicht ändert. Die
bestehende Cloud-Browser-Einschränkung ohne WebGL bleibt dokumentiert und ist kein
Nachweis für eine MapLibre-Regression oder eine echte Geräteabnahme.

## Sicherheit, Privacy und Kosten

### Sicherheit und Privacy

- Der Worker bleibt authoritative Authorization Boundary. UI-Sichtbarkeit,
  Launcher-Zustand und lokale Queue-Daten erteilen keine Berechtigung.
- Campaign-, Area-, Team-, Pickup-, Road- und Mutation-IDs sind Selektoren, keine
  Credentials.
- Collection-Statusmutationen sind von Distribution-Statusmutationen getrennt.
- OSM-Way-ID, Source-ID und Candidate-Tags werden als untrusted, inert data behandelt.
- Adresse und Notiz werden getrimmt, begrenzt und als React-Text ausgegeben. Kein
  eval, kein raw HTML und keine Ausführung von code-artigem Inhalt.
- D1 verwendet ausschließlich gebundene/prepared Statements. Nutzereingaben und
  OSM-Werte werden niemals in SQL oder Overpass-Text konkatenieret.
- Events und Logs enthalten keine Passwörter, TOTP-Daten, Access-/Join-/Session-
  Secrets, Cookies, Session-Hashes, IPs, GPS-Historie oder unbeschränkte Request-
  Bodies.
- Collection-Field-Group-Mitglieder erhalten keine neue Rolle und keine neue
  Identity. Ihre erlaubten Aktionen müssen vor Runtime durch einen bestehenden
  serverseitigen Scope festgelegt werden.
- Keine automatische Geocoding-, GPS- oder externe Routing-Abhängigkeit wird zur
  Umgehung einer Produktentscheidung eingeführt.
- Spätere Organizations erweitern den Tenant-Scope ausdrücklich. Der unakzeptierte
  Identity-/Capability-Entwurf wird nicht vorgezogen.

### Kosten und Skalierung

Ansatz A verursacht zunächst zusätzliche D1-Zeilen für Pickup Tasks und gegebenenfalls
kopierte Geometrie-Snapshots. Das ist kalkulierbarer als doppelte Statusfelder plus
Sondertabellen. Jede Statusänderung kann ein minimiertes Event erzeugen, daher müssen
Event-Wachstum und History-Reads begrenzt/paginiert bleiben. Rollups werden erst bei
gemessenem Bedarf ergänzt.

Zu messen und zu begrenzen sind:

- typische Pickup-Anzahl pro Campaign und Dichte in einer Stadt;
- Größe von Polygon-/Point-Snapshots und M5-Request-Bytes;
- D1-Zeilenwachstum durch Status-Events;
- Candidate-/Pickup-GeoJSON-Größe;
- MapLibre-Layer-Zahl, Initial-SetData, Hit-Test-Latenz und Long Frames;
- DOM-Wachstum, wobei es im Kartenmodus keine Candidate-DOM-Liste geben soll;
- Collection-Road-Daten getrennt von Pickup-Daten.

Bestehende MapLibre-, IndexedDB-, Worker-, D1- und OSM-Package-Pfade werden
wiederverwendet. Es wird keine zweite Datenbank, Queue oder Kartenengine benötigt.
Manuelle Adressen benötigen keine neue Geocoding-API; ohne bestätigte Koordinaten
bleiben sie list-only. Der bestehende Website-only-Betrieb lädt weiter keine
Basemap-Kacheln absichtlich offline.

## Offene Fragen / Unklarheiten

Jede Frage bleibt absichtlich mit UNKLAR markiert, bis Master sie entscheidet oder
eine akzeptierte ADR sie verbindlich macht:

- UNKLAR: Muss jeder Pickup Task einem Area zugeordnet sein?
- UNKLAR: Muss jeder Pickup Task einem Team zugeordnet sein?
- UNKLAR: Darf ein Pickup Task ohne vorhandenen Distribution House Task existieren?
- UNKLAR: Darf ein OSM-Gebäude direkt zum Pickup Task werden, ohne vorher ein House
  Distribution Task zu sein?
- UNKLAR: Soll ein bestehender House Task nur als Referenz dienen oder sollen
  Geometry und Adresse in den Pickup Task kopiert werden?
- UNKLAR: Wie werden gefahrene Straßenabschnitte modelliert?
- UNKLAR: Eigene Pickup-/Collection-Road-Segmente oder Collection-State auf
  Street Tasks?
- UNKLAR: Darf ein Pickup Task unabhängig vom späteren Löschen oder Archivieren des
  referenzierten Distribution Tasks bestehen bleiben?
- UNKLAR: Braucht eine manuelle Call-in-Adresse zwingend Kartenkoordinaten?
- UNKLAR: Falls Koordinaten benötigt werden, wie erfolgt die Zuordnung ohne eine neue
  ungeprüfte Geocoding-API?
- UNKLAR: Welche Collection-Aktionen dürfen temporäre Field-Group-Mitglieder
  ausführen?
- UNKLAR: Welche Pickup-Änderungen werden als domain_events gespeichert?
- UNKLAR: Wie wird eine Collection Field Session von Distribution Sessions getrennt,
  wenn beide denselben Campaign-Scope teilen?
- UNKLAR: Welche Pickup-Daten fließen in Stats und welche Nenner werden angezeigt?
- UNKLAR: Welche Retention gilt für erledigte Pickup Tasks und Collection Events?
- UNKLAR: Dürfen Pickup Tasks editiert oder verschoben werden, nachdem Collection-
  Arbeit bereits protokolliert wurde?
- UNKLAR: Welches App-ID-Präfix und welche globale Eindeutigkeit gelten zwischen
  Street, House und Pickup?
- UNKLAR: Bleibt Campaign im aktuellen Repository der operative Scope, oder wird die
  spätere Action-/Cycle-Struktur aus vorgeschlagenem ADR-0018 vor FC5 verbindlich?
- UNKLAR: Gehören Collection-Road-Segmente zum selben ersten Runtime-Slice wie
  Pickup Tasks oder zu einem unmittelbar folgenden FC5-Slice?
- UNKLAR: Soll Pickup-Context in der bestehenden Kommentar-Domain erlaubt werden,
  oder bleibt Pickup zunächst ohne Kommentare?

Keine dieser Fragen wird durch Remote-Migrationen, GPS-Historie, neue Geocoding-API
oder eine neue Identity-Runtime umgangen.

## Nicht Teil dieses Slices

- Pickup-/Collection-Runtime-Code, D1-Persistenz und normale Collection-Navigation;
- Remote-Anwendung von Migration 0010 oder irgendeiner anderen Migration;
- manueller Cloudflare-Deploy, Merge, Ready for Review, neuer Branch oder neuer PR;
- Feature-Complete-Erklärung auf Basis von PickupPanel, AppMenuModel,
  ActionWorkbenchPreview oder anderer Workbench-/Mock-Daten;
- automatische Übernahme eines Distribution-Status in einen Collection-Status oder
  umgekehrt;
- neue OSM-Abfrageengine, clientseitige OSM-Datenbank, neue Geocoding-API oder
  neue generische Renderer-/Queue-Registry;
- Organization-, Account-, TOTP- und frei konfigurierbare Permission-Runtime;
- Service Worker, installierbare PWA, Background Sync und kontinuierliche GPS-Historie;
- AI-/LLM-Routing, automatische Auftragsvergabe und Worker-Ranglisten;
- endgültige Road-Section-, Retention-, Delete-/Archive- oder Action-Cycle-Entscheidung;
- reale Android-/iPhone-Geräteabnahme. Die offenen Plan-018-Gates bleiben offen:
  Touch-Dichte, Dense-Mobile-Verhalten und HOUSE_MIN_ZOOM 15 als dokumentierter
  Ausgangswert;
- das Verschieben von Plan 017 oder Plan 020 nach completed, bevor die jeweilige
  Runtime-/Dokumentationslage es tatsächlich rechtfertigt.

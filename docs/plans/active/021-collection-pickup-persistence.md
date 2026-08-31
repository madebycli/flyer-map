---
id: plan-021-collection-pickup-persistence
type: plan
status: active
last_updated: 2026-08-31
related: [plan-feature-complete-platform, plan-smart-street-runtime, plan-smart-house-runtime, plan-platform-expansion, product-roadmap, product-ux, map, data, offline-sync, security, collaboration, live-teams, adr-offline-map-data, adr-smart-task-identity, adr-live-field-group-credentials, adr-field-session-events, quality]
source_of_truth_for: [fc5-collection-pickup-persistence-decision, fc5-collection-product-contract]
---

# Plan 021: Collection / Pickup Persistenz

## Ziel

FC5 Collection / Pickup wird als eigener Arbeitsbereich neben Distribution umgesetzt. Master hat nach dem A/B-Vergleich die Produktanforderungen festgelegt, die Ansatz A verbindlich machen: First-Class Collection-Daten mit eigenen Areas, Runs, Straßenabschnitten, Pickup Tasks, Statuswerten und temporären Collection-Zugängen.

Distribution und Collection teilen Campaign/Aktion, MapLibre, Worker, D1 und die bestehende M5-Queue, aber nicht ihre fachlichen Task-Identitäten oder Arbeitsstatus. Änderungen oder Archivierungen in Distribution verändern Collection nicht und umgekehrt. Nur das Löschen der gesamten Campaign/Aktion darf beide Bereiche gemeinsam entfernen.

Plan 021 bleibt für FC5.3 und die realen Mobile-/Touch-Acceptance-Gates aktiv. FC5.1 und der vollständige FC5.2-Runtime-Scope sind als normale Produktwege implementiert und auf GitHub verifiziert.

## Anforderungen

### Verifizierte Baseline vor dieser Entscheidung

- Repository: `madebycli/flyer-map`.
- Branch: `plan-feature-complete-platform`.
- Draft PR #72 gegen `ui-app-launcher-sheet`.
- FC5.1-Code-Head: `78472b660d58b6d9184a2a63730a5a25e8fd7841`.
- CI #735 war auf exakt diesem Code-Head mit Test, Typecheck, Dependency Audit und Production Build vollständig grün.
- Plan 018, 019 und 020 sind abgeschlossen; die reale Geräteabnahme für Plan 018 bleibt offen.
- Remote D1 ist weiterhin nur bis Migration 0001 bis 0003 dokumentiert.
- 0004 bis 0010 sind vorbereitet und nicht remote angewendet.
- Die Cloud-Browser-Umgebung besitzt kein nutzbares WebGL. Das ist kein Beleg für eine MapLibre-Regression.
- Reale Android-/iPhone-Gates für FC4 bleiben separat offen.

Vor jeder späteren Runtime-Änderung müssen Branch, PR, exakter Head und CI erneut gegen GitHub verifiziert werden.

### Gewählte Produktgrenzen

- Collection ist vollständig von Distribution getrennt.
- Collection besitzt ein eigenes Hauptgebiet und eigene innere Arbeitsgebiete. Diese dürfen größer, kleiner oder vollständig anders geschnitten sein als Distribution Areas.
- Das Collection-Hauptgebiet wird als leichte graue Fläche dargestellt.
- Innere Collection Areas liegen farblich darüber. Ihre Farbe soll visuell nicht mit der grauen Hauptfläche vermischt werden.
- Nicht in ein inneres Gebiet aufgeteilte Fläche innerhalb des Hauptgebiets bleibt als leicht grauer, noch nicht zugewiesener Bereich erkennbar.
- Ein Pickup Task kann überall im Collection-Hauptgebiet entstehen, auch ohne vorhandenen Distribution House Task.
- Ein Pickup kann zunächst ohne innere Area-Zuordnung in einer unzugewiesenen Intake-Liste bestehen. Für normale Feldarbeit kann er anschließend einer Collection Area zugeordnet werden.
- Wird ein Distribution Street/House Task gelöscht oder archiviert, bleibt ein daraus abgeleiteter Pickup unverändert bestehen.
- Wird ein Collection-Objekt archiviert oder geändert, beeinflusst das Distribution nicht.
- Erst beim Löschen der gesamten Campaign/Aktion werden zugehörige Distribution- und Collection-Daten gemeinsam entfernt.
- Ein aus Street/House/OSM übernommener Pickup speichert einen eigenen Adress- und Geometrie-Snapshot. Eine optionale Referenz dient nur Provenance/Nachvollziehbarkeit.
- OSM IDs sind nie Pickup-, Area-, Run- oder Road-Primärschlüssel.

### Collection Areas, Runs und freiwillige Helfer

Der Collection-Betrieb ist nicht an die persistenten Distribution Teams gekoppelt.

- Helfer kommen dynamisch und häufig ohne bestehenden Account.
- Ein Campaign-spezifischer Collection-QR-Code öffnet ausschließlich den Collection-Bereich.
- Das Scannen darf ohne vorherigen normalen Account einen temporären, Collection-only Zugriff erzeugen.
- Der gemeinsame QR-Code ist nur ein Eintrittspunkt. Jedes Gerät erhält danach eine eigene temporäre Collector-Identität mit app-eigener ID und einer neutralen sichtbaren Bezeichnung wie `Nutzer 1`, `Nutzer 2`, `Nutzer 3`.
- Der QR-/Collector-Zugang erteilt niemals Distribution-, Admin- oder Organizations-Rechte.
- Der Worker bleibt für alle Reads/Writes die Autorisierungsgrenze.
- Admin/Operator kann einen einzelnen Collector-Zugang widerrufen.
- Die Sammlung arbeitet mit `Collection Runs` beziehungsweise Fahrten statt persistenten Distribution Teams.
- Eine Fahrt kann je nach Fahrzeug/Kapazität ein oder mehrere Collection Areas übernehmen.
- Ein kleines Fahrzeug kann kleinere Areas beziehungsweise mehrere Fahrten benötigen, ein großes Fahrzeug kann mehrere Areas gleichzeitig übernehmen.
- Andere Helfer sehen, dass eine Area bereits bearbeitet wird, inklusive Fortschritt.
- Andere Geräte dürfen einer bereits laufenden Fahrt über `Beitreten` beitreten.
- Mehrere Geräte derselben Fahrt dürfen Fortschritt eintragen.
- Verlässt ein Teilnehmer eine Fahrt, bleibt die Fahrt bestehen, solange andere Mitglieder weiterarbeiten.
- Es gibt einen deutlichen manuellen `Verlassen`-/`Freigeben`-/`Abbrechen`-Flow.
- Es gibt ausdrücklich kein automatisches Timeout und keine automatische Freigabe wegen Inaktivität.
- Admin/Operator darf Areas zwangsweise freigeben oder neu zuordnen.

### Collection Road Sections

Collection-Straßen sind First-Class Collection-Daten und kein Zusatzstatus auf Distribution Streets.

Vorgesehene Statuswerte:

- `open` -> Offen
- `driven` -> Abgefahren
- `later` -> Später
- `unavailable` -> Nicht befahrbar

Road Sections besitzen eigene App-IDs, eigene Geometrie-Snapshots, Area-/Run-Kontext und eigene Stats. Sie dürfen unabhängig von Distribution zugeschnitten werden.

### Pickup Tasks und Sonderadressen

Bestehende Pickup-Statuswerte bleiben:

- `open`
- `collected`
- `unavailable`
- `needs-follow-up`

Für einen Pickup beziehungsweise eine Sonderadresse werden mindestens gespeichert:

- app-eigene ID;
- Campaign-Scope;
- optionale innere Collection Area;
- verpflichtende Kartenposition;
- Adresse;
- Titel;
- Beschreibung;
- Archivstatus;
- eigener Pickup-Status;
- optionaler Collection-Run-/Assignee-Kontext;
- optionale OSM-/Distribution-Provenance;
- created/updated actor und Zeit;
- eigener Adress-/Geometrie-Snapshot.

Ein einzelner Pickup wird nicht hart gelöscht. Maximal archivieren. Die Position/Adresse darf später bearbeitet werden, auch wenn bereits Arbeit protokolliert wurde; diese Änderung muss nachvollziehbar als neuer Domain-Change gespeichert werden.

### Online-Adresssuche mit OSM-Daten

Für `Sonderadresse hinzufügen` ist eine echte Online-Adresssuche gewünscht.

UX:

1. Plus-/Hinzufügen-Aktion öffnet eine Suchoberfläche im bestehenden Sheet-System.
2. Auf Mobile verhält sie sich wie die anderen Bottom Sheets; Desktop darf dieselbe Komponente kompakter/zentriert darstellen.
3. Die Suche fühlt sich wie eine Spotlight-/Maps-Suche an.
4. Resultate zeigen Adresse und Entfernung.
5. Auswahl eines Resultats fokussiert/zoomt MapLibre auf den Treffer und zeigt einen Marker.
6. Danach kann der Nutzer `Sonderadresse hinzufügen` wählen.
7. Titel, Adresse und Beschreibung werden im Erstell-Flow angezeigt.
8. Alternativ kann die Kartenposition per Finger/Maus gesetzt oder korrigiert werden.
9. Eine Sonderadresse benötigt immer Koordinaten.

Daten-/Provider-Grenze:

- OpenStreetMap/OSM-derived Adressdaten sind die gewünschte Datenbasis.
- Der produktive FC5.2-Adapter ist Geoapify Address Autocomplete über den Worker; der öffentliche Nominatim-Dienst wird nicht als Live-Autocomplete verwendet.
- Provider-Credentials bleiben serverseitig im Worker.
- Suche wird hart auf das Collection-Hauptgebiet begrenzt; Provider-BBox/Proximity wird zusätzlich gegen die Hauptgebietsgeometrie geprüft.
- Bei einmalig freigegebenem Gerätestandort wird nach Distanz zu diesem Punkt sortiert. Ohne Location-Permission wird der aktuelle Kartenmittelpunkt verwendet.
- Distanz wird als Meter/Kilometer angezeigt.
- Keine kontinuierliche GPS-Historie und keine Speicherung einer Bewegungsroute.
- Geoapify-/OpenStreetMap-Attribution wird sichtbar aus dem Worker-Vertrag gerendert.
- Search ist serverseitig rate-limitiert, validiert, timeout-begrenzt und liefert kontrollierte Fehlerzustände.

### Sonderadressen und Berechtigungen

Sonderadressen sind standardmäßig für Collection-Helfer sichtbar.

Collection-spezifische serverseitige Capabilities unterscheiden:

- Sonderadressen sehen, Default `true`;
- Sonderadressen erstellen, Default `false`;
- Sonderadressen bearbeiten, Default `false`;
- Sonderadressen zuweisen, Default `false`.

Admin/Operator kann diese Rechte für einzelne temporäre Collector-Zugänge erweitern. Das ist eine enge FC5-Berechtigung und darf nicht als Vorwand dienen, die spätere generische Organizations-/Permission-Runtime vorzuziehen.

Eine konkrete Sonderadresse kann einem oder mehreren aktiven Collectors/Runs zugewiesen werden. Assignment wird serverseitig gegen Campaign, Pickup, aktiven Run-/Collector-Zustand und `can_assign_pickups` validiert.

### Kommentare und Beschreibung

Pickup Tasks erhalten:

- `Titel`;
- `Adresse`;
- `Beschreibung`;
- einen normalen Kommentar-Thread.

Beschreibung ist der statische fachliche Vermerk zum Pickup. Kommentare nutzen die bestehende durable Comment-Domain mit persistentem Target Context `pickup-task`. Der additive Forward-Slice 0013 erweitert die bestehende Comment-/Event-Schema-Grenze, ohne historische Migration 0008 umzuschreiben.

### Actor-Provenance, Highlight und gezieltes Zurücksetzen

Jede authoritative Collection-Änderung muss dem temporären Collector/Admin/Operator zugeordnet werden können.

Admin/Operator soll:

- Beiträge eines Collectors auf Karte/Liste filtern beziehungsweise highlighten können;
- einzelne Änderungen gezielt auswählen können;
- ausgewählte Änderungen fachlich zurücksetzen können;
- optional alle fachlichen Beiträge eines Collector-Zugangs zur Prüfung auswählen können;
- den Collector-Zugang widerrufen können.

Das ist kein lineares `Undo, Undo, Undo` und kein direktes Löschen von Datenbankzeilen.

Revert wird durch eine neue serverautorisierte compensating mutation ausgeführt. Audit-/Event-Historie bleibt erhalten. Bei komplexen Änderungen muss vor dem Revert die aktuelle Revision/Abhängigkeit geprüft werden, damit fremde spätere Arbeit nicht unbemerkt überschrieben wird.

## Architektur (gewählter Ansatz)

**Gewählt durch Master: Ansatz A, First-Class Collection/Pickup.**

Ansatz B, Collection-State auf bestehenden Distribution Street/House Tasks, ist verworfen, weil die Produktanforderungen ausdrücklich getrennte Gebiete, Fahrten, Personen, Straßenabschnitte, Pickup-Lifecycles und Berechtigungen verlangen.

Architekturfluss:

```text
Collection QR / normaler Admin-Zugang
-> temporärer Collector Access oder Admin/Operator
-> Collection Main Area
-> Collection Areas
-> Collection Run + Mitglieder + Area Claims
-> Collection Road Sections / Pickup Tasks
-> bestehende M5 Mutation Queue
-> Worker Authorization + Validation
-> additive D1 Collection Persistenz
-> minimierte Domain Events / reversible Collection Changes
-> MapLibre + Comments + Collection Stats
```

Verbindlich:

- App-eigene IDs überall;
- OSM nur als Datenquelle/Provenance;
- gleiche MapLibre-Engine;
- gleiche M5-Queue;
- gleicher Worker;
- D1 bleibt Persistenz;
- Distribution und Collection status-/lifecycle-seitig getrennt;
- Campaign ist bis zu einer später akzeptierten Action/Cycle-Architektur der gemeinsame obere Scope;
- Campaign-Delete darf Collection kaskadieren, Distribution-Objekt-Delete nicht.

## Dateistruktur

FC5.1 ist umgesetzt. FC5.2 erweitert denselben Produktgraph insbesondere um:

1. `migrations/0011_fc5_collection_pickups.sql` für First-Class Pickup-Persistenz und Create/Edit/Assign-Capabilities;
2. `migrations/0012_fc5_collection_pickup_visibility.sql` für die rückwärtskompatible View-Capability;
3. `migrations/0013_fc5_pickup_comments.sql` für den additiven persistenten Pickup-Comment-/Actor-Contract;
4. `src/domain/pickup.ts`, Pickup-Mutationen und bestehende M5-Diff-/Queue-Pfade;
5. `worker/pickupSearch.ts`, Pickup-Repositories/-Autorisierung und Collection-Snapshot-Augmentation;
6. `src/collection/PickupPanel.tsx`, `PickupAssignmentEditor.tsx`, `CollectionCollectorView.tsx` und `CollectionAdminPanel.tsx` für den normalen Produktweg;
7. `src/map/pickupRenderer.ts` und feste MapLibre-Pickup-Layer;
8. bestehende Comments-, Security- und Quality-Pfade statt zweiter Parallel-Subsysteme.

Keine neue generische Registry oder zweite Datenzugriffsschicht nur für FC5 einführen.

## Umsetzungsschritte

FC5 wird in vertikalen, echten Produkt-Slices umgesetzt. Keine Foundation-/Preview-only Lieferung zählt als abgeschlossen.

### FC5.1 Collection Access, Areas und Runs

Normaler Flow:

```text
Collection QR
-> Collection-only Collector
-> offene Collection Areas als Liste/Karte
-> eine oder mehrere Areas übernehmen
-> Collection Run startet
-> weitere Geräte können beitreten
-> Fortschritt sichtbar
-> Verlassen/Freigeben manuell
```

Ist als normaler Produktweg persistiert, serverautorisiert, M5-kompatibel und erreichbar. Der Slice verwendet Collection-only QR Access, pro Gerät eigene Collector-Sessions, getrennte Main/Child Areas, Mehrfach-Claims, aktive Runs, Join, manuellen Leave/Release/Cancel-Flow und Admin force release. Migration 0010 bleibt vorbereitet und wird nicht remote angewendet.

### FC5.2 Pickup Tasks, Sonderadressen, Suche, Kommentare und Assignment

**Status: Runtime vollständig implementiert und auf Code-Head `824ddbe946ddfaf1f5b46ba64ab6ea09f128c3f3` mit CI #794 vollständig grün verifiziert. Reale Android-/iPhone-Abnahme bleibt als Hardware-Gate offen.**

Normaler Flow:

```text
Plus
-> Adresssuche
-> OSM-derived Geoapify Online-Search über Worker
-> Resultat nach Nähe/Hauptgebiet
-> Map fokussiert + Marker
-> Sonderadresse anlegen
-> Titel/Adresse/Beschreibung
-> bestehende M5-Queue
-> Worker/D1
-> Pickup auf Karte/Liste
-> Kommentar / Status / Zuweisung
```

Zusätzlich manueller Karten-Tap/-Korrektur. Pickup kann ohne Distribution House existieren.

Implementierte Checkpoints:
- A: Pickup Visibility und vier enge Collector-Capabilities;
- B: echter Sonderadress-Composer mit Geoapify/OSM-derived Search, Main-Area-Filter, Bias, Distanz, Rate Limit, Timeout und Attribution;
- C: permanente MapLibre-Pickup-Darstellung über eine feste GeoJSON-Source und feste Layer, ohne per-feature DOM-Marker;
- D: durable Pickup Comments über bestehende Comment-Domain und additive Migration 0013;
- E: Admin-/Collector-Assignment an aktive Runs/Collectors über denselben `PickupAssignmentEditor`, den bestehenden `collection.pickup.set-assignment`-Vertrag und dieselbe M5-Queue.

### FC5.3 Collection Road Sections, Stats und Attribution

- eigene Collection Road Sections;
- Status Offen/Abgefahren/Später/Nicht befahrbar;
- Fortschritt je Area/Run/Campaign;
- getrennte Pickup- und Road-Nenner;
- actor-attributed Events;
- Filter/Highlight nach Collector;
- gezieltes serverseitiges Revert ausgewählter Änderungen;
- Admin force release/reassignment.

Wenn Repository-Abhängigkeiten eine andere Reihenfolge zwingend machen, darf Codex die technische Reihenfolge ändern, aber nicht die fachlichen Grenzen oder einen Preview-Ersatz.

## Tests und Quality Gates

FC5.1 ist durch `tests/collectionRuntime.test.ts` sowie die bestehenden Mutation-, Authorization-, Snapshot-, Persistence- und Security-Tests abgedeckt. Geprüft werden Collection-only Scope, getrennte Collector-Identitäten, Main/Child Areas, Mehrfach-Claims, Join, Leave/Release, Cancel, Admin force release, App-ID-Identität, OSM-Provenance-Grenze, M5-Verhalten und der Ausschluss von Preview-/Mock-Daten aus dem Produktionsgraph.

FC5.2 deckt zusätzlich ab:
- Pickup ohne Distribution House und verpflichtende Koordinaten;
- Archive statt Hard Delete sowie narrow Create/Edit/Status/Assignment-Mutationen;
- M5 offline/retry/duplicate/conflict/401/403/schema gate;
- View default true und Create/Edit/Assign default false;
- View=false filtert Snapshot und blockiert Search/Write;
- Search Main-Area-Bounds, Polygon-Filter, Proximity/Map-Center-Fallback, Distanz, Race-/Abort-Verhalten, Provider-Fehler, Rate Limit, Timeout und Secret-Isolation;
- permanente MapLibre-Source/feste Layer, app-eigene IDs und minimierte Properties;
- Pickup Comments inklusive Schema-Gate, Migrationserhalt, Collector-Actor, View=false und Moderationsgrenzen;
- Assignment nur an aktive Runs/Collectors, Collector-Capability, atomare Zuweisung und stale Revision conflict;
- normaler Admin-/Collector-Produktgraph ohne zweite Queue, Map-Engine oder Comment-UI.

Der vollständige FC5.2-Code-Checkpoint ist auf Head `824ddbe946ddfaf1f5b46ba64ab6ea09f128c3f3` mit CI #794 grün: 543 Tests sowie Typecheck, Dependency Audit und Production Build.

Die reale Android-/iPhone-Abnahme und Touch-Dichte bleiben wie bei Plan 018 offene Hardware-Gates.

Spätere FC5.3-/Acceptance-Slices müssen mindestens prüfen:

- QR erzeugt nur Collection-Scope und keine Distribution/Admin-Rechte;
- jedes Gerät erhält getrennte app-eigene Collector-Identität;
- Revocation blockiert neue Reads/Writes serverseitig;
- kein automatisches Timeout existiert;
- Collection Areas sind unabhängig von Distribution Areas;
- Distribution Delete verändert Collection nicht;
- Campaign Delete entfernt Collection-Daten gemäß FK-/Lifecycle-Vertrag;
- Collection Road Status verändert niemals Distribution Street Status;
- getrennte Stats-Nenner;
- Actor Attribution;
- gezielter Revert ist idempotent und überschreibt keine neuere fremde Änderung ohne Konflikt;
- Touch-/Keyboard-/Screenreader-Alternativen;
- Android Chromium und iPhone Safari als reale Acceptance Gates.

Quality Commands:

```bash
npm test
npm run typecheck
npm run audit:dependencies
npm run build
npm run check
```

CI zählt nur, wenn es auf exakt dem aktuellen Head grün ist.

## Sicherheit, Privacy und Kosten

- Worker bleibt authoritative Authorization Boundary.
- QR-Code ist ein Capability-Einstieg, kein öffentlicher allgemeiner Account.
- QR-/Session-/Collector-Tokens sind high entropy, revocable und nicht als Klartext in D1/Logs/Events abzulegen.
- Reuse der vorhandenen Access-/Temporary-Credential-Muster vor neuer Auth-Mechanik.
- Collector-ID ist Selektor/Audit-Identität und nicht das Credential selbst.
- Kein Client-only Capability Check.
- Keine Secrets in MapLibre Properties.
- Adresse, Titel, Beschreibung, Kommentare und Provider-Daten sind untrusted/inert.
- Prepared/bound D1 Statements.
- Kein SQL aus String-Konkatenation.
- Keine kontinuierliche GPS-Historie.
- One-shot Location nur für UI-Ranking/Fokus, wenn der Nutzer erlaubt.
- Geoapify läuft über den Worker mit serverseitigem Credential und enger Rate-Limit-/Main-Area-Grenze.
- Geoapify-/OSM-Attribution wird sichtbar gerendert; aktuelle Provider-Kosten-/Nutzungsgrenzen sind im FC5.2-Handoff dokumentiert.
- Kein unbegrenztes Search-as-you-type gegen den Provider.
- Keine neue Datenbank, Queue, Map-Engine oder externe Routing-Engine.
- Bestehendes Cloudflare/D1/MapLibre-Setup bevorzugen.
- Gesamtrichtung bleibt auf sehr niedrige laufende Kosten ausgerichtet.

## Offene Fragen / Unklarheiten

Die bisherigen A/B-Produktfragen und die FC5.2-Geocoder-Auswahl sind entschieden.

Nicht blockierende technische Punkte für FC5.3:

- minimale reversible Change-Repräsentation für selektiven Admin-Revert ohne Full Event Sourcing;
- genaue Retention von abgeschlossenen Collection Runs und Audit Changes. Historie darf nicht stillschweigend gelöscht werden.

Diese Punkte erfordern keine weitere Produktentscheidung von Master, solange die Implementierung die oben festgelegten Grenzen einhält. Falls eine technische Auswahl zusätzliche Kosten, neue externe Credentials oder eine neue irreversible Architekturgrenze erzeugt, muss Codex stoppen und die Alternativen dokumentieren.

## Nicht Teil dieses Slices

- Kopplung von Collection-Status an Distribution Tasks;
- automatische Freigabe/Timeout von übernommenen Areas;
- kontinuierliches GPS-Tracking;
- GPS-Routenhistorie;
- neue allgemeine Organizations-/Identity-/Permission-Runtime;
- neue Map-Engine;
- zweite Sync-Queue;
- öffentliche internetweite Collector-Discovery;
- AI-/LLM-Routing;
- automatisches Fahrzeug-Routing oder automatische Gebietsverteilung;
- Remote-Anwendung vorbereiteter Migrationen;
- manueller Cloudflare-Deploy;
- Merge oder Ready for Review von PR #72;
- neuer Branch oder neuer PR, solange nicht ausdrücklich angeordnet.
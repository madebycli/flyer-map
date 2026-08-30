---
id: plan-021-collection-pickup-persistence
type: plan
status: active
last_updated: 2026-08-30
related: [plan-feature-complete-platform, plan-smart-street-runtime, plan-smart-house-runtime, plan-platform-expansion, product-roadmap, product-ux, map, data, offline-sync, security, collaboration, live-teams, adr-offline-map-data, adr-smart-task-identity, adr-live-field-group-credentials, adr-field-session-events, quality]
source_of_truth_for: [fc5-collection-pickup-persistence-decision, fc5-collection-product-contract]
---

# Plan 021: Collection / Pickup Persistenz

## Ziel

FC5 Collection / Pickup wird als eigener Arbeitsbereich neben Distribution umgesetzt. Master hat nach dem A/B-Vergleich die Produktanforderungen festgelegt, die Ansatz A verbindlich machen: First-Class Collection-Daten mit eigenen Areas, Runs, Straßenabschnitten, Pickup Tasks, Statuswerten und temporären Collection-Zugängen.

Distribution und Collection teilen Campaign/Aktion, MapLibre, Worker, D1 und die bestehende M5-Queue, aber nicht ihre fachlichen Task-Identitäten oder Arbeitsstatus. Änderungen oder Archivierungen in Distribution verändern Collection nicht und umgekehrt. Nur das Löschen der gesamten Campaign/Aktion darf beide Bereiche gemeinsam entfernen.

Plan 021 bleibt für die noch offenen FC5.2- und FC5.3-Slices aktiv. FC5.1 ist als normaler Produktweg implementiert und verifiziert.

## Anforderungen

### Verifizierte Baseline vor dieser Entscheidung

- Repository: `madebycli/flyer-map`.
- Branch: `plan-feature-complete-platform`.
- Draft PR #72 gegen `ui-app-launcher-sheet`.
- FC5.1-Code-Head: `3a5c46aafa47e866b8441a380f34918eda1f0cee`.
- CI #729 war auf exakt diesem Code-Head mit Test, Typecheck, Dependency Audit und Production Build vollständig grün.
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
- Vor Implementierung muss der aktuelle Provider und dessen aktuelle Nutzungsrichtlinie geprüft werden.
- Der öffentliche Nominatim-Dienst darf nicht ungeprüft als produktives Live-Autocomplete fest verdrahtet werden.
- Codex soll einen OSM-basierten Geocoder auswählen, der den benötigten Search-Flow, Rate Limits, Datenschutz und das Kostenlimit zuverlässig trägt.
- Bevorzugt wird der einfachste ToS-konforme Ansatz ohne neue Client-Dependency.
- Provider-Credentials, falls überhaupt nötig, bleiben serverseitig.
- Suche wird bevorzugt hart auf das Collection-Hauptgebiet begrenzt. Falls der Provider nur BBox/Proximity unterstützt, werden Treffer zusätzlich gegen die Hauptgebietsgeometrie geprüft.
- Falls ausnahmsweise noch kein Hauptgebiet existiert, darf ein kleiner begrenzter Fallback-Radius verwendet werden; keine weltweite ungebremste Resultatliste.
- Bei einmalig freigegebenem Gerätestandort wird nach Distanz zu diesem Punkt sortiert. Ohne Location-Permission wird der aktuelle Kartenmittelpunkt verwendet.
- Distanz wird als Meter/Kilometer angezeigt.
- Keine kontinuierliche GPS-Historie und keine Speicherung einer Bewegungsroute.

### Sonderadressen und Berechtigungen

Sonderadressen sind standardmäßig für Collection-Helfer sichtbar.

Collection-spezifische serverseitige Capabilities sollen mindestens unterscheiden:

- Sonderadressen sehen, Default `true`;
- Sonderadressen erstellen, Default `false`;
- Sonderadressen bearbeiten, Default `false`;
- Sonderadressen zuweisen, Default `false`.

Admin/Operator kann diese Rechte für einzelne temporäre Collector-Zugänge oder passende Collection-Gruppen erweitern. Das ist eine enge FC5-Berechtigung und darf nicht als Vorwand dienen, die spätere generische Organizations-/Permission-Runtime vorzuziehen.

Eine konkrete Sonderadresse kann bei Bedarf einem oder mehreren Collectors/Runs zugewiesen werden.

### Kommentare und Beschreibung

Pickup Tasks erhalten:

- `Titel`;
- `Adresse`;
- `Beschreibung`;
- einen normalen Kommentar-Thread.

Beschreibung ist der statische fachliche Vermerk zum Pickup. Kommentare nutzen die bestehende durable Comment-Domain und werden um `pickup` als erlaubten Target Context erweitert, sobald die Worker-/Schema-Grenzen dies sicher tragen.

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

FC5.1 ist umgesetzt. Der Runtime-Slice nutzt:

1. `migrations/0010_fc5_collection_access_areas_runs.sql` für additive Collection-Tabellen;
2. `src/domain/collection.ts` für First-Class IDs, Statuswerte und Snapshot-Validierung;
3. `src/domain/mutations.ts` und `src/domain/mutationDiff.ts` für explizite `collection.*`-Mutationen im bestehenden M5-Vertrag;
4. `worker/collectionAccess.ts`, Collection-Repositories und Worker-Routen für QR Access, Session und Persistenz;
5. `src/collection/CollectionCollectorView.tsx`, `src/collection/CollectionAdminPanel.tsx` und feste MapLibre-Layer für den normalen Produktweg.

Danach insbesondere prüfen:

- `src/domain/campaign.ts`;
- Worker Repository-/Snapshot-/Mutation-/Authorization-Dateien;
- vorhandene Live-Field-Group-/Temporary-Credential-Implementierung;
- `src/data/mutationQueue.ts`;
- `src/map/MapView.tsx`;
- bestehende Area-/House-/Street-Geometriedaten;
- `src/collection/PickupPanel.tsx`;
- Comments;
- Field Sessions / domain_events;
- Statistics;
- PlatformShell/Launcher/Sheets;
- Tests.

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

### FC5.2 Pickup Tasks, Sonderadressen, Suche und Kommentare

Normaler Flow:

```text
Plus
-> Adresssuche
-> OSM-basierter Online-Search
-> Resultat nach Nähe/Hauptgebiet
-> Map fokussiert + Marker
-> Sonderadresse anlegen
-> Titel/Adresse/Beschreibung
-> M5
-> Worker/D1
-> Pickup auf Karte/Liste
-> Kommentar / Status
```

Zusätzlich manueller Karten-Tap/-Korrektur. Pickup kann ohne Distribution House existieren.

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

FC5.1 ist durch `tests/collectionRuntime.test.ts` sowie die bestehenden Mutation-, Authorization-, Snapshot-, Persistence- und Security-Tests abgedeckt. Geprüft werden Collection-only Scope, getrennte Collector-Identitäten, Main/Child Areas, Mehrfach-Claims, Join, Leave/Release, Cancel, Admin force release, App-ID-Identität, OSM-Provenance-Grenze, M5-Verhalten und der Ausschluss von Preview-/Mock-Daten aus dem Produktionsgraph. CI #729 ist auf dem FC5.1-Code-Head vollständig grün.

Die reale Android-/iPhone-Abnahme und Touch-Dichte bleiben wie bei Plan 018 offene Hardware-Gates.

Spätere Runtime-Slices müssen mindestens prüfen:

- QR erzeugt nur Collection-Scope und keine Distribution/Admin-Rechte;
- jedes Gerät erhält getrennte app-eigene Collector-Identität;
- Revocation blockiert neue Reads/Writes serverseitig;
- ein Collector kann eine oder mehrere Areas übernehmen;
- zweite Geräte sehen claimed/in-progress und können beitreten;
- kein automatisches Timeout existiert;
- Leave/Release und Admin force release funktionieren;
- Collection Areas sind unabhängig von Distribution Areas;
- Distribution Delete verändert Collection nicht;
- Campaign Delete entfernt Collection-Daten gemäß FK-/Lifecycle-Vertrag;
- Pickup ohne Distribution House;
- Pickup erfordert Koordinaten;
- kopierter House/OSM Snapshot bleibt nach Distribution-Änderung stabil;
- Pickup Archive statt Hard Delete;
- Edit nach vorhandener Historie erzeugt nachvollziehbaren Change;
- Search-Ergebnisse werden auf Hauptgebiet begrenzt beziehungsweise nachträglich gefiltert;
- Proximity-Sortierung und Distanzanzeige;
- Search ohne Location-Permission nutzt Map Center;
- keine GPS-Historie;
- providerseitige Rate-Limit-/Fehlerzustände;
- keine Secrets im Client;
- Sonderadresse visible Default true;
- create/edit/assign Default false;
- Pickup Comments serverautorisiert;
- Collection Road Status verändert niemals Distribution Street Status;
- getrennte Stats-Nenner;
- Actor Attribution;
- gezielter Revert ist idempotent und überschreibt keine neuere fremde Änderung ohne Konflikt;
- M5 offline/retry/duplicate/conflict/401/403/schema gate;
- MapLibre verwendet gebatchte Sources/feste Layer, keine per-feature React/SVG/Canvas-Struktur;
- Touch-/Keyboard-/Screenreader-Alternativen;
- Android Chromium und iPhone Safari als reale spätere Acceptance Gates.

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
- Geocoder über Worker/konfigurierten Adapter, wenn Provider-Key/Rate-Limit/Privacy das erfordert.
- Provider-ToS, Attribution, Request-Limits und Kosten vor Auswahl dokumentieren.
- Kein unbegrenztes Search-as-you-type gegen einen Dienst, der dies nicht erlaubt.
- Keine neue Datenbank, Queue, Map-Engine oder externe Routing-Engine.
- Bestehendes Cloudflare/D1/MapLibre-Setup bevorzugen.
- Gesamtrichtung bleibt auf sehr niedrige laufende Kosten ausgerichtet; ein kostenpflichtiger Geocoder braucht eine ausdrückliche Begründung und kalkulierbare Limits.

## Offene Fragen / Unklarheiten

Die bisherigen A/B-Produktfragen sind durch Master entschieden.

Nicht blockierende technische Punkte, die Codex anhand Repository und aktueller Provider-Regeln klären und dokumentieren soll:

- FC5.1 ist für die Collection-Core-Tabellen in Migration 0010 mit getrennten Tabellen für Main Area, Child Areas, Runs, Collector-Sessions, Mitglieder und Claim-Historie festgelegt;
- `UNKLAR:` welcher OSM-basierte Online-Geocoder die aktuellen Nutzungsbedingungen, Rate Limits, Datenschutz, Proximity/BBox und Kosten am besten erfüllt;
- FC5.1 verwendet getrennte Main-Area- und Child-Area-Tabellen, damit Collection- und Distribution-Lifecycles explizit getrennt bleiben;
- `UNKLAR:` minimale reversible Change-Repräsentation für selektiven Admin-Revert ohne Full Event Sourcing;
- `UNKLAR:` genaue Retention von abgeschlossenen Collection Runs und Audit Changes. Historie darf nicht stillschweigend gelöscht werden.

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

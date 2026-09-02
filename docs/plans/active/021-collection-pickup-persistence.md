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

FC5 Collection / Pickup ist ein eigener Arbeitsbereich neben Distribution. Master hat First-Class Collection-Daten als verbindlichen Ansatz gewählt: eigene Main Area, Collection Areas, Runs, Road Sections, Pickup Tasks, Statuswerte und temporäre Collection-Zugänge.

Distribution und Collection teilen Campaign/Aktion, MapLibre, Worker, D1 und die bestehende M5-Queue, aber nicht ihre fachlichen Task-Identitäten oder Arbeitsstatus. Änderungen oder Archivierungen in Distribution verändern Collection nicht und umgekehrt. Nur das Löschen der gesamten Campaign/Aktion darf beide Bereiche gemeinsam entfernen.

Plan 021 bleibt aktiv für FC5.3 sowie reale Mobile-/Touch-Acceptance-Gates. FC5.1 und der vollständige FC5.2-Runtime-Scope sind als normale Produktwege implementiert und auf GitHub verifiziert.

## Verifizierter FC5.2-Runtime-Checkpoint

```text
Branch: plan-feature-complete-platform
PR: #72 Draft gegen ui-app-launcher-sheet
Head: f9967033048cf03f2839cd41924cc1bd524a69c5
CI: #807 success
```

CI #807 ist auf exakt diesem Code-Head grün mit Tests, Typecheck, Dependency Audit und Production Build. Spätere reine Living-Docs-Heads benötigen ihre eigene exakte CI-Verifikation.

Remote D1 bleibt dokumentiert ausschließlich bis Migration 0001 bis 0003. Migrationen 0004 bis 0013 sind vorbereitet und nicht remote angewendet. Kein manueller Deploy, Merge oder Ready-for-Review gehört zu diesem Plan-Slice.

## Gewählte Produktgrenzen

### Collection versus Distribution

- Collection ist fachlich vollständig von Distribution getrennt.
- Collection besitzt ein eigenes Hauptgebiet und eigene innere Arbeitsgebiete. Diese dürfen größer, kleiner oder anders geschnitten sein als Distribution Areas.
- Das Collection-Hauptgebiet wird als leichte graue Fläche dargestellt; innere Collection Areas liegen farblich darüber.
- Unzugewiesene Fläche innerhalb des Hauptgebiets bleibt als grauer Bereich erkennbar.
- Distribution Street/House Delete oder Archive verändert Collection nicht.
- Collection Edit/Archive verändert Distribution nicht.
- Erst Campaign-Delete darf beide Domänen gemeinsam entfernen.
- OSM-/Geocoder-IDs sind nie Collection-Primärschlüssel.
- App-eigene IDs bleiben authoritative.

### Collection Areas, Runs und freiwillige Helfer

- Helfer benötigen keinen vorher angelegten normalen Account.
- Ein Campaign-spezifischer Collection-QR öffnet Collection-only Access.
- Jedes Gerät erhält eine eigene temporäre, revocable Collector-Identität mit app-eigener ID und neutraler Bezeichnung.
- Collection QR/Collector Access erteilt keine Distribution-, Admin- oder Organization-Rechte.
- Worker bleibt für Reads und Writes die Autorisierungsgrenze.
- Admin kann einzelne Collector-Zugänge widerrufen.
- Collection arbeitet mit Runs/Fahrten statt persistenten Distribution Teams.
- Ein Run kann eine oder mehrere Collection Areas übernehmen.
- Andere Geräte sehen Claims/Fortschritt und können einem aktiven Run beitreten.
- Mehrere Geräte eines Runs dürfen Fortschritt eintragen.
- Verlassen, Freigeben und Abbrechen sind explizite manuelle Flows.
- Es gibt kein automatisches Inaktivitäts-Timeout und keine automatische Area-Freigabe.
- Admin darf Areas zwangsweise freigeben oder neu zuordnen.

### Collection Road Sections

Collection-Straßen sind First-Class Collection-Daten und kein Zusatzstatus auf Distribution Streets.

Vorgesehene Statuswerte für FC5.3:
- `open` / Offen;
- `driven` / Abgefahren;
- `later` / Später;
- `unavailable` / Nicht befahrbar.

Road Sections besitzen eigene App-IDs, eigene Geometrie-Snapshots, Area-/Run-Kontext und eigene Stats.

## Pickup Tasks / Sonderadressen

Pickup-Statuswerte:
- `open`;
- `collected`;
- `unavailable`;
- `needs-follow-up`.

Ein Pickup speichert mindestens:
- app-eigene ID;
- Campaign-Scope;
- optionale Collection Area;
- verpflichtende Kartenposition;
- Titel;
- Adresse;
- Beschreibung;
- Pickup-Status;
- Archivstatus;
- optionale Run-/Collector-Zuweisungen;
- optionale OSM-/Distribution-Provenance;
- created/updated actor und Zeit;
- eigenen Adress-/Geometrie-Snapshot.

Ein Pickup kann überall im Collection-Hauptgebiet entstehen, auch ohne Distribution House. Er kann zunächst ohne innere Area-Zuordnung bestehen.

Ein einzelner Pickup wird niemals hart gelöscht. Er wird soft archiviert. Titel, Adresse, Beschreibung und Kartenposition dürfen später bearbeitet werden. Die Änderung läuft als eigener Domain-Change über den bestehenden Pickup-Mutationspfad. Bereits archivierte Pickups sind nicht mehr editierbar, bleiben aber für Prüfung/Audit erhalten.

## Online-Adresssuche mit OSM-derived Daten

Normaler Create-Flow:

```text
Sonderadresse hinzufügen
-> Maps-/Spotlight-artige Suche
-> Worker-basierter Geoapify Address Autocomplete auf OSM-derived Daten
-> Resultate im Collection-Hauptgebiet
-> Entfernung anzeigen
-> Treffer auswählen
-> MapLibre fokussiert den Treffer
-> Titel / Adresse / Beschreibung
-> Position übernehmen oder manuell korrigieren
-> bestehende M5-Queue
-> Worker / D1
-> Pickup auf Karte und Liste
```

Verbindliche Provider-/Privacy-Grenzen:
- Geoapify Address Autocomplete ist der produktive FC5.2-Adapter;
- der öffentliche Nominatim-Dienst wird nicht als produktives Search-as-you-type verwendet;
- Provider-Credentials bleiben ausschließlich serverseitig im Worker;
- Search ist hart auf die Collection Main Area begrenzt und wird zusätzlich gegen das echte Polygon gefiltert;
- einmalig freigegebener Gerätestandort darf Ranking/Fokus unterstützen;
- ohne Location-Permission wird der aktuelle MapLibre-Kartenmittelpunkt verwendet;
- Distanz wird in Meter/Kilometer angezeigt;
- kein `watchPosition`, keine kontinuierliche GPS-Historie, keine Bewegungsroute;
- Geoapify-/OpenStreetMap-Attribution wird sichtbar gerendert;
- Search besitzt Debounce, Abort/Race-Schutz, serverseitiges Rate Limit, Validation, Timeout und kontrollierte Fehlerzustände.

## Pickup Capabilities

Temporäre Collection Collector besitzen vier enge serverseitige Pickup-Capabilities:
- View, Default `true`;
- Create, Default `false`;
- Edit, Default `false`;
- Assign, Default `false`.

View=false ist authoritative und setzt Pickup Search/Write effektiv außer Kraft, ohne Collection Areas/Runs zu verstecken.

Create benötigt View + Create. Status, Edit und Archive benötigen View + Edit. Assignment benötigt View + Assign. Admin-Autorisierung bleibt authoritative und unabhängig von Collector-Flags.

Admin kann diese vier Rechte pro Collector verwalten. Das bleibt eine enge FC5-Grenze und zieht keine generische Organizations-/Permission-Runtime vor.

## Assignment

Ein Pickup kann einem oder mehreren aktiven Collection Runs beziehungsweise Collector-Kontexten zugewiesen werden.

- Admin und Collector verwenden denselben `PickupAssignmentEditor`;
- Mutation bleibt `collection.pickup.set-assignment`;
- derselbe M5-Pfad wird verwendet;
- Worker validiert Campaign, Pickup sowie aktive Run-/Collector-Referenzen authoritative;
- geschlossene/abgebrochene Runs und widerrufene Collector werden abgelehnt;
- stale Revisionen konfliktieren ohne Teilzustand.

## Kommentare und Beschreibung

Pickup Tasks besitzen Titel, Adresse, Beschreibung und einen normalen Kommentar-Thread.

Beschreibung ist der statische fachliche Vermerk. Kommentare nutzen die bestehende durable Comment-Domain mit Target `pickup-task`.

Prepared-only Forward Migration 0013 erweitert die bestehenden Comment-/Event-CHECK-Verträge additiv um `pickup-task` und Actor `collection-collector`, ohne historische Migrationen 0007 oder 0008 zu verändern. Bestehende Daten und die betroffenen Field-Group-Trigger werden beim SQLite-Rebuild erhalten.

Collection Collector benötigen Pickup View für Comment Reads/Writes. Collector dürfen Kommentare erstellen, aber nicht selbst moderieren. Normale Campaign-Admin-Autorisierung bleibt authoritative.

Archivierte Pickups behalten ihren Comment-Thread und können über die Archivprüfung weiterhin kontrolliert werden.

## MapLibre-Vertrag

MapLibre 5.7.1 bleibt einzige Kartenengine.

Permanente Pickup-Darstellung:
- eine feste GeoJSON-Source `vf-collection-pickups`;
- feste Marker-/Selection-Layer;
- app-eigene Pickup-ID als Feature- und Selection-Identität;
- Map Properties nur `pickupId` und `status`;
- keine Adresse, Beschreibung, Actor-, Provider-, Credential- oder OSM-Provenance in Map Properties;
- archivierte oder ungültig positionierte Pickups werden nicht gerendert;
- keine per-feature DOM Marker;
- Daten- und Selection-Updates bleiben getrennt.

Admin und Collector verwenden dieselbe MapLibre-Engine. Der Admin-Pickup-Workspace ist ein weiterer MapLibre-View desselben Renderers, keine zweite Map-Engine.

## Architekturfluss

```text
Collection QR / normaler Admin-Zugang
-> temporärer Collector Access oder Admin
-> Collection Main Area
-> Collection Areas
-> Collection Run + Mitglieder + Claims
-> Pickup Tasks / später Collection Road Sections
-> zentraler Snapshot-Commit
-> bestehende M5 Mutation Queue
-> Worker Authorization + Validation
-> additive D1 Collection Persistenz
-> minimierte Domain Events
-> MapLibre + Comments + Stats
```

Verbindlich:
- App-eigene IDs überall;
- OSM/Geoapify nur Datenquelle/Provenance;
- gleiche MapLibre-Engine;
- gleiche M5-Queue;
- gleicher Worker;
- D1 bleibt Persistenz;
- keine zweite Pickup API oder zweite Offline Queue;
- keine Preview-/Mock-Daten im normalen Produktpfad.

## Migrationen

Prepared only, nicht remote angewendet:
- `0010_fc5_collection_access_areas_runs.sql`;
- `0011_fc5_collection_pickups.sql`;
- `0012_fc5_collection_pickup_visibility.sql`;
- `0013_fc5_pickup_comments.sql`.

0011 enthält First-Class Pickup-Persistenz plus Create/Edit/Assign-Capabilities. 0012 ergänzt View rückwärtskompatibel. 0013 erweitert Comments/Events additiv. Historische 0007/0008 werden nicht umgeschrieben.

## Umsetzungsschritte

### FC5.1: Collection Access, Areas und Runs

Status: implementiert.

```text
Collection QR
-> Collection-only Collector
-> offene Collection Areas
-> eine oder mehrere Areas übernehmen
-> Run startet
-> weitere Geräte können beitreten
-> Fortschritt sichtbar
-> Leave / Release / Cancel manuell
-> Admin Force Release
```

### FC5.2: First-Class Pickup Tasks

Status: Runtime vollständig implementiert. Code-Checkpoint `f9967033048cf03f2839cd41924cc1bd524a69c5`, CI #807 success. Reale Android-/iPhone-Abnahme bleibt als Hardware-Gate offen.

Implementierte Checkpoints:

- **A Visibility/Capabilities**: View default true, Create/Edit/Assign default false, authoritative View-Filter und Admin Capability UI.
- **B Search/Composer**: echter Geoapify/OSM-derived Search, Main-Area-Filter, Distanz/Bias, Rate Limit, Timeout, Attribution, manuelle Map-Korrektur und bestehender M5-Create-Pfad.
- **C Renderer**: permanente feste MapLibre-Source/-Layer, app-eigene IDs, minimierte Properties, archivierte Pickups aus dem Renderer entfernt.
- **D Comments**: durable `pickup-task` Comments, additive Migration 0013, Collector Actor, View-Gate und Moderationsgrenzen.
- **E Assignment**: gemeinsamer Admin-/Collector-Editor, aktive Referenzen, `can_assign_pickups`, bestehender M5-Vertrag.
- **F Lifecycle/Admin Completion**: späteres Edit von Titel/Adresse/Beschreibung/Position, Soft-Archive, Archivprüfung inklusive Comments und vollständiger Admin Search-/Map-/Create-/Status-/Edit-/Archive-Produktweg.

Checkpoint F nutzt:
- `src/collection/PickupLifecyclePanel.tsx` für Edit/Archive/Archivprüfung;
- `src/collection/CollectionCollectorView.tsx` für capability-gatete Collector-Writes mit tatsächlichem Collector Actor;
- `src/collection/CollectionAdminPickupWorkspace.tsx` für den normalen Admin Search-/Map-/Composer-/Lifecycle-Flow;
- `src/collection/CollectionAdminPanel.tsx` als erreichbare Admin-Oberfläche;
- `tests/pickupLifecycleUi.test.ts` als gezielte Regression.

Save ohne fachliche Pickup-Änderung wird vor dem Snapshot-Commit verworfen, damit der M5-Diff keine künstliche Revision ohne Operation erhält.

## Tests und Quality Gates

FC5.2 deckt mindestens ab:
- Pickup ohne Distribution House und Pflichtkoordinaten;
- Create/Edit/Status/Archive/Assignment über enge Pickup-Mutationen;
- Archive statt Hard Delete;
- M5 offline/retry/duplicate/conflict/401/403/schema gate;
- View default true, Create/Edit/Assign default false;
- View=false filtert Snapshot und blockiert Search/Write;
- Geoapify Search Main-Area-Bounds, Polygon-Filter, Proximity/Map-Center-Fallback, Distanz, Race/Abort, Provider-Fehler, Rate Limit, Timeout und Secret-Isolation;
- permanente MapLibre-Source/feste Layer, app-eigene IDs und minimierte Properties;
- Pickup Comments einschließlich Schema-Gate, Migrationserhalt, Collector Actor, View=false und Moderationsgrenzen;
- Assignment nur an aktive Runs/Collectors und stale conflict;
- Collector Edit/Archive nur mit Edit-Capability;
- Admin realer Search-/Map-/Create-/Edit-/Archive-Pfad;
- archivierte Pickups nicht auf der Karte, aber weiterhin prüfbar;
- kein zweiter Queue-/Map-/Comment-Pfad.

Verifizierter Runtime-Code-Checkpoint:

```text
Head: f9967033048cf03f2839cd41924cc1bd524a69c5
CI: #807 success
```

Quality Commands:

```bash
npm test
npm run typecheck
npm run audit:dependencies
npm run build
npm run check
```

CI zählt nur, wenn sie auf exakt dem aktuellen Head grün ist.

## FC5.3: nächster Runtime-Scope

FC5.3 bleibt separat:
- First-Class Collection Road Sections;
- Status Offen/Abgefahren/Später/Nicht befahrbar;
- Fortschritt je Area/Run/Campaign;
- getrennte Pickup- und Road-Nenner;
- Actor Attribution und Highlight;
- gezieltes serverseitiges compensating Revert mit Revision-/Konfliktprüfung;
- Admin force release/reassignment bleibt verfügbar.

Keine FC5.3-Funktion in einen FC5.2-Hotfix zurückstapeln.

## Actor-Provenance / Revert

Jede authoritative Collection-Änderung muss dem handelnden Collector/Admin zugeordnet werden können. Worker persistiert authoritative Actor-Provenance.

Spätere FC5.3-Admin-Funktionen sollen Beiträge filtern/highlighten und ausgewählte Änderungen über serverautorisierte compensating mutations zurücksetzen. Kein lineares Undo und kein direktes Löschen historischer DB-Zeilen. Audit-Historie bleibt erhalten und Konflikte mit späterer fremder Arbeit müssen erkannt werden.

## Sicherheit, Privacy und Kosten

- Worker bleibt authoritative Authorization Boundary.
- QR/Session/Collector Tokens sind high entropy und revocable; keine Klartext-Credentials in D1/Logs/Events.
- Collector-ID ist Audit-/Selektor-Identität, nicht Credential.
- Keine Client-only Security-Entscheidung.
- Keine Secrets in MapLibre Properties.
- Adresse, Titel, Beschreibung, Kommentare und Provider-Daten bleiben untrusted/inert.
- Prepared/bound D1 Statements.
- Keine kontinuierliche GPS-Historie.
- One-shot Location nur nach Nutzerfreigabe.
- Geoapify über Worker mit engem Rate Limit und Main-Area-Grenze.
- sichtbare Geoapify-/OSM-Attribution.
- keine neue Datenbank, Queue, Map-Engine oder Routing-Engine.
- bestehendes Cloudflare/D1/MapLibre-Setup bevorzugen.
- laufende Kosten niedrig halten.

## Reale Acceptance-Gates

Noch nicht als durchgeführt behaupten:
- Android Chromium;
- iPhone Safari;
- Touch-Dichte und Dense-Mobile-Verhalten;
- Search-Ergebniswahl und manuelle Kartenposition auf echten Touch-Geräten;
- Comment-/Assignment-/Edit-/Archive-Bedienung auf echten Geräten.

Cloud-Browser/CI sind kein Ersatz für diese Gates.

## Nicht Teil des FC5.2-Abschlusses

- Collection Road Sections;
- Collection/Pickup Stats;
- Actor Highlight/Attribution UI;
- compensating Revert;
- automatische Freigabe/Timeout von Areas;
- kontinuierliches GPS-Tracking oder Routenhistorie;
- allgemeine Organizations-/Identity-/Permission-Runtime;
- neue Map-Engine;
- zweite Sync-Queue;
- AI-/LLM-Routing;
- automatisches Fahrzeug-Routing oder automatische Gebietsverteilung;
- Remote-Anwendung vorbereiteter Migrationen;
- manueller Cloudflare-Deploy;
- Merge oder Ready for Review von PR #72;
- neuer Branch oder neuer PR ohne ausdrücklichen Auftrag.

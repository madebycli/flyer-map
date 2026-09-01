# Continue Feature Complete Platform

Du arbeitest weiter am GitHub-Projekt `madebycli/flyer-map`.

Repository und GitHub sind die einzige Source of Truth. Prüfe vor jeder Änderung Branch, PR #72, exakten Head und CI. Wenn GitHub diesem Prompt widerspricht, gilt GitHub.

## Aktiver Stack

```text
Branch: plan-feature-complete-platform
PR: #72
Base: ui-app-launcher-sheet
Draft: true
Merge: verboten
Ready: verboten
Remote Migration: verboten
Manueller Deploy: verboten
Neuer Branch/PR: verboten
```

## Abgeschlossener M5-Transition: kein Legacy-Snapshot-Write

Der Snapshot ist nach Abschluss der M5-Transition ausschließlich Read Model, UI-Modell, Startup-Cache und Konflikt-/Sicherheitskopie:

- `POST /api/campaigns` ist ein einmaliger, atomarer Initial-Create mit validierter `revision: 0`; bestehende Campaigns werden nicht ersetzt;
- `GET /api/campaigns/:id/snapshot` und `GET /api/campaigns/:id/version` bleiben erhalten;
- `PUT /api/campaigns/:id/snapshot` antwortet mit HTTP 410 und `legacy_snapshot_write_retired`, ohne Payload-Verarbeitung, Access-Auflösung, Revision-Claim oder D1-Write;
- `replaceCampaignSnapshot`, der Client-Helper `putCampaignSnapshot` und automatische Legacy-Recovery sind entfernt;
- normale Campaign-, Team-, Area-, Street-, House-, Collection- und Pickup-Änderungen laufen über explizite M5- oder spezialisierte Mutationen;
- bei leerer Queue speichert der Store einen lokalen Mismatch als Konfliktkopie, übernimmt den kanonischen Serverzustand und zeigt einen sichtbaren Konflikthinweis; ein automatischer Server-PUT findet nicht statt.

Dieser Slice ändert keine Migration und führt keine zweite Queue, Datenbank oder Mutation-Domain ein.

Letzter vollständig grüner FC5.2-Runtime-Code-Checkpoint:

```text
Head: f9967033048cf03f2839cd41924cc1bd524a69c5
CI: #807 success
```

CI #807 ist auf exakt diesem Head grün mit Tests, Typecheck, Dependency Audit und Production Build. Dieser Prompt kann auf einem späteren reinen Living-Docs-Head liegen; vor weiterer Runtime-Arbeit muss auch dessen exakte CI verifiziert werden.

## Abgeschlossener Map-/Smart-Data-Hardening-Slice

Der nächste Map-Hardening-Slice aktualisiert den bestehenden PR #72 ohne neuen Branch oder neue Architektur:

- aktive Basemap ist OpenFreeMap Bright (`/styles/bright`), Provider-`fill-extrusion` wird entfernt und MapLibre bleibt auf 2D-Pitch 0;
- der kontrollierte Hausnummern-Layer bleibt `openmaptiles` / `housenumber`, ist ab Zoom 16 zoom-skaliert größer und behält normale Collision-Erkennung;
- der bestehende MapLibre-GeolocateControl läuft mit `trackUserLocation: true`, schnellem kürzlich bekannten Fix und offiziellem Active-/Passive-Follow, ohne GPS-Persistenz oder History;
- historische Smart Street/House-Helfer und die begrenzte Paket-API können als isolierter Bestand bleiben, sind aber kein normaler Area-Sheet-Pfad;
- der normale Produktweg wird durch Plan 023/024 serverseitig vorbereitet, nicht durch browserseitige OSM-Paket-Fetches;
- Settings hat keinen normalen Offline-Karten-Download mehr, M5 und Snapshot-Cache bleiben unverändert.

Der Fix ist auf Runtime-Head `619cf690859ff21a4a8599f7762f38b0e27a013d` mit GitHub-CI #816 (Tests, Typecheck, Dependency Audit und Production Build) grün verifiziert; der automatisierte Workers-Build-Check ist ebenfalls erfolgreich. Reale WebGL-/Android-/iPhone-Abnahme bleibt offen, sofern sie nicht tatsächlich durchgeführt wurde.

## Abgeschlossener Backend-Slice: automatische Area-Vorbereitung

Plan 023 ergänzt den bestehenden PR ohne neue Produkt-Queue oder Kartenengine:

- ein erfolgreich persistiertes, nicht wiederholtes `area.create` oder `area.update-geometry` plant serverseitig einen begrenzten OSM-Job;
- der Worker liest ausschließlich die kanonische D1-Area, clippt Roads exakt auf das Polygon und publiziert Street-/House-Tasks atomar als normale Snapshot-Tasks;
- automatische Tasks tragen eine servereigene Preparation-Generation, manuelle Tasks bleiben unverändert; Statusänderungen sind normal möglich, Client-Delete automatischer Tasks ist gesperrt;
- die enge Preparation-Status/Retry-Route besitzt dieselbe Area-Scope-Autorisierung; Viewer und Field-Group-Mitglieder dürfen nicht starten;
- Migration 0014 ist prepared-only. Kein Remote-Rollout, kein Massenvorbereiten alter Areas und kein Browser-OSM-Job als persistente Wahrheit;
- Plan 024 ist abgeschlossen: der editierbare normale Area Sheet liest den Status, startet `missing` genau einmal, pollt `pending` nur offen, refresht bei `ready` genau einmal und bietet bei `failed` einen autorisierten Retry ohne Schema-Retry-Loop;
- die Smart-Auswahlbuttons, per-Device Smart-Paket-Fetches und der Settings-Download sind aus dem normalen Produktweg entfernt; `Straße manuell hinzufügen` bleibt verfügbar;
- automatische Street-/House-Tasks nutzen ausschließlich `vf-streets` und `vf-houses`; automatische Streets sind nicht umbenennbar/löschbar, Status bleibt normal änderbar.

## Pflichtkontext

Lies zuerst vollständig:

1. `AGENTS.md`
2. `docs/status/CURRENT.md`
3. `docs/context-map.yaml`
4. `docs/plans/active/017-feature-complete-platform.md`
5. `docs/plans/active/021-collection-pickup-persistence.md`
6. `docs/plans/completed/023-auto-area-task-preparation.md` bei automatischer Area-Vorbereitung oder Migration 0014
7. `docs/plans/completed/024-auto-area-ui-server-preparation.md` bei normalem Area-Sheet, Preparation-Polling/Retry, Completed-Farbe oder Smart-/Offline-UI-Entfernung

Folge für FC5 im Context Graph ab `plan-collection-pickup-persistence` insbesondere zu Roadmap, UX, Data, Offline Sync, Map, Security, Collaboration, Live Teams und Quality. Keine parallele FC5-Topologie einführen, solange die bestehende Graph-Struktur ausreicht.

## FC5.1

Collection Access, Main/Child Areas und Runs sind als normale persistente Produktwege umgesetzt:
- Collection-only QR Access;
- pro Gerät eigene revocable Collector-Identität;
- Main Area und unabhängige Collection Areas;
- Mehrfach-Claims;
- Runs, Join, Leave, Release, Cancel und Admin Force Release;
- Worker-Autorisierung und bestehende M5-Queue.

## FC5.2: vollständig implementierter Runtime-Scope

FC5.2 ist auf Code-Head `f9967033048cf03f2839cd41924cc1bd524a69c5` mit CI #807 vollständig grün. Reale Android-Chromium-/iPhone-Safari-Abnahme bleibt als Hardware-Gate offen und darf nicht als durchgeführt behauptet werden.

### A. Pickup Visibility / Capabilities

- `canViewPickups=true` als rückwärtskompatibler Default;
- Create/Edit/Assign default false;
- additive prepared-only Migration 0012;
- View=false filtert Pickup-Daten und blockiert Pickup Search/Write serverseitig;
- Areas/Runs bleiben sichtbar;
- Admin kann View/Create/Edit/Assign je Collector verwalten;
- keine generische Permission-Runtime.

### B. Sonderadress-Suche und Composer

Normaler Pfad:

```text
Sonderadresse hinzufügen
-> Worker-basierter Geoapify Address Autocomplete auf OSM-derived Daten
-> Main-Area-/Polygon-Filter
-> Distanz/Bias
-> Treffer auswählen
-> MapLibre-Fokus
-> Titel / Adresse / Beschreibung / Pflichtposition
-> bestehender Snapshot-zu-M5-Pickup-Mutationspfad
```

Verbindliche Grenzen:
- Geoapify Credential ausschließlich serverseitig;
- Rate Limit, Input Validation und Timeout im Worker;
- Main Area authoritative;
- einmalige Device Location optional, sonst aktueller MapLibre-Kartenmittelpunkt;
- kein `watchPosition`, keine GPS-Historie;
- Debounce, Abort und Race-Schutz;
- sichtbare Geoapify-/OpenStreetMap-Attribution;
- manuelle Positionskorrektur ohne erfundene externe Provenance.

### C. Permanenter Pickup-Renderer

- eine feste GeoJSON-Source `vf-collection-pickups`;
- feste Marker-/Selection-Layer;
- app-eigene Pickup-ID als Feature-/Selection-ID;
- Map Properties nur `pickupId` und `status`;
- keine Adresse, Beschreibung, Actor-, Credential-, Provider- oder OSM-Provenance im Renderer;
- archivierte beziehungsweise ungültig positionierte Pickups werden nicht gerendert;
- MapLibre-Hitbox, keine per-feature DOM Marker;
- Dense-Test mit 5.000 Pickups bei konstanter Source-/Layer-Zahl.

### D. Durable Pickup Comments

- bestehende Comment-Domain und `CommentsContextPanel`;
- persistenter Target Context `pickup-task`;
- additive prepared-only Migration 0013;
- historische 0007/0008 bleiben unverändert;
- 0013 erhält Bestandsdaten und stellt die betroffenen 0007-Trigger nach dem SQLite-Rebuild wieder her;
- Worker prüft Campaign, Pickup-Existenz und Pickup-View serverseitig;
- Collector Actor wird als `collection-collector` persistiert;
- Collector darf Kommentare erstellen, aber nicht moderieren;
- fehlende 0013 fail-closed als `pickup_comments_schema_unavailable`.

### E. Pickup Assignment

- Admin und Collector verwenden denselben `PickupAssignmentEditor`;
- bestehender `collection.pickup.set-assignment`-Mutationsvertrag und dieselbe M5-Queue;
- Collector benötigt View + `can_assign_pickups`;
- aktive Runs und aktive/nicht widerrufene Collector-Kontexte;
- Worker validiert Campaign, Pickup und aktive Referenzen authoritative;
- stale Revision konfliktet ohne Teilzustand.

### F. Pickup Edit, Soft-Archive, Archivprüfung und vollständiger Admin-Flow

Normaler Collector-Pfad:
- berechtigter Collector kann aktive Pickups über `PickupLifecyclePanel` bearbeiten;
- Titel, Adresse, Beschreibung und Kartenposition sind editierbar;
- Save ohne fachliche Änderung erzeugt keine künstliche Pickup-Mutation;
- `can_edit_pickups` bleibt serverseitige Grenze für Update, Status und Archive;
- Collector-optimistic Snapshot setzt den tatsächlichen `collection-collector` Actor;
- einzelne Pickups werden nur soft archiviert, nie hart gelöscht;
- archivierte Pickups verschwinden aus aktivem List-/Map-Work, bleiben aber in einer Archivprüfung inklusive Comment-Thread erhalten.

Normaler Admin-Pfad:
- `CollectionAdminPickupWorkspace` nutzt dieselbe MapLibre-Engine und denselben `PickupPanel`-Composer;
- Admin kann suchen, Karte fokussieren, manuell positionieren, erstellen, Status ändern, Kommentare nutzen, später Titel/Adresse/Beschreibung/Position bearbeiten und soft archivieren;
- Assignment bleibt im bestehenden Admin-Assignment-Editor;
- alle fachlichen Pickup-Änderungen laufen weiter über den zentralen `onSnapshotChange`/`commitSnapshot`-Weg und dadurch über dieselbe M5-Queue; der Snapshot selbst wird nicht als allgemeiner Schreibpayload versendet;
- keine zweite Pickup API, Queue, Datenbank oder Map-Engine.

Gezielte Regression: `tests/pickupLifecycleUi.test.ts` hält Edit/Archive/Admin-Produktgraph und den bestehenden M5-Update-/Archive-Vertrag fest.

## Migration State

Dokumentierter Remote-D1-Stand bleibt ausschließlich 0001 bis 0003.

Prepared only, nicht remote angewendet:
- 0004 Smart Street provenance;
- 0005 House Tasks;
- 0006 Field Groups;
- 0007 Field Sessions / Domain Events;
- 0008 Comments;
- 0009 Automationen;
- 0010 Collection Access / Areas / Runs;
- 0011 Collection Pickups + Create/Edit/Assign Capabilities;
- 0012 Pickup Visibility;
- 0013 Pickup Comments Forward Migration.
- 0014 automatische Area-Task-Vorbereitung.

Keine Migration als Diagnose remote anwenden.

## Nächster Runtime-Scope: FC5.3

FC5.2 bekommt keinen weiteren normalen Runtime-Slice, solange GitHub nichts Gegenteiliges zeigt. Plan 021 bleibt aktiv für:
- First-Class Collection Road Sections mit `open`, `driven`, `later`, `unavailable`;
- getrennte Collection Road-/Pickup-Stats;
- Actor Attribution und Highlight;
- gezieltes compensating Revert mit Revision-/Konfliktprüfung.

Parallel offen bleiben reale Android-/iPhone-Touch-/Dense-Mobile-Abnahmen für FC4/FC5.

## Globale Grenzen

- MapLibre 5.7.1 bleibt einzige Kartenengine.
- M5 bleibt einzige Mutation Queue.
- App-eigene IDs bleiben authoritative; OSM-/Geocoder-IDs sind nur Datenquelle/Provenance.
- Worker bleibt Authorization Boundary.
- Keine Secrets im Client oder in Map Properties.
- Keine kontinuierliche GPS-Historie.
- Keine zweite Datenbank/Queue/Map-Engine.
- vollständige Snapshot-PUTs sind kein Schreibweg und liefern 410 `legacy_snapshot_write_retired`;
- `POST /api/campaigns` bleibt Create-only mit Revision 0;
- Keine Preview-/Mock-Daten im normalen Produktpfad.
- Remote D1 bleibt dokumentiert nur 0001 bis 0003 applied.
- Migrationen 0007/0008 nicht historisch verändern.
- Keine Remote-Migration.
- Kein manueller Deploy.
- Kein Merge oder Ready.
- Kein neuer Branch oder PR.

## Abschluss-/Handoff-Regel

Nach jedem neuen Runtime- oder Living-Docs-Head:
1. exakten Branch-Head erneut lesen;
2. CI auf genau diesem SHA prüfen;
3. PR #72 offen, Draft, mergeable und unmerged verifizieren;
4. `docs/status/CURRENT.md` und diesen Prompt nur mit tatsächlich verifiziertem Stand aktualisieren;
5. reale Device-Abnahmen niemals aus Cloud-/CI-Ergebnissen ableiten.
